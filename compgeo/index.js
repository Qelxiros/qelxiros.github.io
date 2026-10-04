window.onload = function () {
  const canvas = document.getElementById("webglCanvas");
  const gl =
    canvas.getContext("webgl", {
      preserveDrawingBuffer: true,
      antialias: true,
    }) || canvas.getContext("experimental-webgl");

  if (!gl) {
    alert("WebGL is not supported in your browser.");
    return;
  }

  // Enable Alpha blending for smooth antialiased points and shapes
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  const vertexShaderSource = `
                attribute vec2 a_position;
                attribute vec4 a_color;
                attribute float a_size;
                attribute float a_shape;

                uniform vec2 u_resolution;

                varying vec4 v_color;
                varying float v_shape;

                void main() {
                    // Convert position from pixels to 0.0 -> 1.0 clip space
                    vec2 zeroToOne = a_position / u_resolution;
                    
                    // Convert from 0->1 to 0->2
                    vec2 zeroToTwo = zeroToOne * 2.0;
                    
                    // Convert from 0->2 to -1->+1 (clip space)
                    vec2 clipSpace = zeroToTwo - 1.0;
                    
                    // Flip Y axis (WebGL origin is bottom-left, DOM origin is top-left)
                    gl_Position = vec4(clipSpace * vec2(1, -1), 0, 1);
                    
                    // Set point size
                    gl_PointSize = a_size;

                    // Pass data down to Fragment Shader
                    v_color = a_color;
                    v_shape = a_shape;
                }
            `;

  const fragmentShaderSource = `
                precision mediump float;

                varying vec4 v_color;
                varying float v_shape;

                void main() {
                    // Normalize point coord to range [-1.0, 1.0] from center
                    vec2 coord = gl_PointCoord * 2.0 - 1.0;
                    float dist = length(coord);
                    float alpha = v_color.a;

                    // Shape 0: Circle
                    if (v_shape < 0.5) {
                        if (dist > 1.0) discard;
                        // Antialiasing edge blur
                        alpha *= smoothstep(1.0, 0.8, dist);
                    } 
                    // Shape 1: Square
                    else if (v_shape < 1.5) {
                        // Sharp edge square
                        if (abs(coord.x) > 0.95 || abs(coord.y) > 0.95) discard;
                    } 
                    // Shape 2: Star
                    else if (v_shape < 2.5) {
                        float angle = atan(coord.y, coord.x);
                        float r = 0.5 + 0.4 * cos(angle * 5.0);
                        if (dist > r) discard;
                        alpha *= smoothstep(r, r - 0.1, dist);
                    } 
                    // Shape 3: Glow Ring
                    else {
                        float ringInner = 0.4;
                        float ringOuter = 0.9;
                        if (dist < ringInner || dist > ringOuter) discard;
                        float ringDist = abs(dist - (ringInner + ringOuter) * 0.5);
                        alpha *= smoothstep(0.3, 0.0, ringDist);
                    }

                    gl_FragColor = vec4(v_color.rgb, alpha);
                }
            `;

  function createShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error("Shader compilation error:", gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
  const fragmentShader = createShader(
    gl,
    gl.FRAGMENT_SHADER,
    fragmentShaderSource,
  );

  const program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error("Program link error:", gl.getProgramInfoLog(program));
    return;
  }

  gl.useProgram(program);

  const positionLocation = gl.getAttribLocation(program, "a_position");
  const colorLocation = gl.getAttribLocation(program, "a_color");
  const sizeLocation = gl.getAttribLocation(program, "a_size");
  const shapeLocation = gl.getAttribLocation(program, "a_shape");
  const resolutionUniformLocation = gl.getUniformLocation(
    program,
    "u_resolution",
  );

  // Buffer layout per point: [x, y, r, g, b, a, size, shape] -> 8 floats per point
  const FLOATS_PER_POINT = 8;
  let pointsData = [];

  const pointBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, pointBuffer);

  const clearBtn = document.getElementById("clearBtn");

  clearBtn.addEventListener("click", () => {
    pointsData = [];
    updatePointCount();
    render();
  });

  function updatePointCount() {
    const count = pointsData.length / FLOATS_PER_POINT;
  }

  function hexToRgba(hex) {
    let c = hex.replace("#", "");
    if (c.length === 3) {
      c = c
        .split("")
        .map((x) => x + x)
        .join("");
    }
    const num = parseInt(c, 16);
    return [
      ((num >> 16) & 255) / 255,
      ((num >> 8) & 255) / 255,
      (num & 255) / 255,
      1.0,
    ];
  }

  function resizeCanvas() {
    const displayWidth = canvas.clientWidth;
    const displayHeight = canvas.clientHeight;

    if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
      canvas.width = displayWidth;
      canvas.height = displayHeight;
      gl.viewport(0, 0, canvas.width, canvas.height);
    }
  }

  function addPoint(x, y) {
    const size = 10.0;
    const [r, g, b, a] = [0.0, 0.0, 1.0, 1.0];
    const shape = 0.0;

    // Add data floats to point array
    pointsData.push(x, y, r, g, b, a, size, shape);

    updatePointCount();
    render();
  }

  let isDrawing = false;

  function getCanvasCoordinates(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }

  canvas.addEventListener("pointerdown", (e) => {
    const pos = getCanvasCoordinates(e);
    addPoint(pos.x, pos.y);
  });

  window.addEventListener("resize", () => {
    resizeCanvas();
    render();
  });

  function render() {
    resizeCanvas();

    // Clear background to dark slate color
    gl.clearColor(0.02, 0.04, 0.08, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    if (pointsData.length === 0) return;

    gl.useProgram(program);

    // Set screen resolution uniform
    gl.uniform2f(resolutionUniformLocation, canvas.width, canvas.height);

    // Buffer attribute array
    gl.bindBuffer(gl.ARRAY_BUFFER, pointBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array(pointsData),
      gl.DYNAMIC_DRAW,
    );

    const FSIZE = Float32Array.BYTES_PER_ELEMENT;
    const stride = FLOATS_PER_POINT * FSIZE;

    // Position Attribute (2 floats: X, Y)
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, stride, 0);

    // Color Attribute (4 floats: R, G, B, A)
    gl.enableVertexAttribArray(colorLocation);
    gl.vertexAttribPointer(
      colorLocation,
      4,
      gl.FLOAT,
      false,
      stride,
      2 * FSIZE,
    );

    // Size Attribute (1 float)
    gl.enableVertexAttribArray(sizeLocation);
    gl.vertexAttribPointer(sizeLocation, 1, gl.FLOAT, false, stride, 6 * FSIZE);

    // Shape Attribute (1 float)
    gl.enableVertexAttribArray(shapeLocation);
    gl.vertexAttribPointer(
      shapeLocation,
      1,
      gl.FLOAT,
      false,
      stride,
      7 * FSIZE,
    );

    // Draw WebGL Points
    const count = pointsData.length / FLOATS_PER_POINT;
    gl.drawArrays(gl.POINTS, 0, count);
  }

  // Initial render call
  resizeCanvas();
  render();
};
