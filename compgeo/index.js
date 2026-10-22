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

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  const vertexShaderSource = `
    attribute vec2 a_position;
    uniform vec2 u_resolution;

    void main() {
      vec2 zeroToOne = a_position / u_resolution;
      vec2 clipSpace = zeroToOne * 2.0 - 1.0;

      gl_Position = vec4(clipSpace * vec2(1, -1), 0, 1);
      gl_PointSize = 5.0;
    }
  `;

  const fragmentShaderSource = `
    precision mediump float;

    void main() {
      vec2 coord = gl_PointCoord * 2.0 - 1.0;
      float dist = length(coord);

      if (dist > 1.0) discard;

      float alpha = 1.0 - smoothstep(0.8, 1.0, dist);
      gl_FragColor = vec4(0.0, 0.0, 1.0, alpha);
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
  const resolutionUniformLocation = gl.getUniformLocation(
    program,
    "u_resolution",
  );

  const FLOATS_PER_POINT = 2;
  let pointsData = [];

  const pointBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, pointBuffer);

  const clearBtn = document.getElementById("clearBtn");

  clearBtn.addEventListener("click", () => {
    pointsData = [];
    render();
  });

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
    pointsData.push(x, y);
    render();
  }

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

    gl.clearColor(1.0, 1.0, 1.0, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    if (pointsData.length === 0) return;

    gl.useProgram(program);
    gl.uniform2f(resolutionUniformLocation, canvas.width, canvas.height);

    gl.bindBuffer(gl.ARRAY_BUFFER, pointBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array(pointsData),
      gl.DYNAMIC_DRAW,
    );

    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.POINTS, 0, pointsData.length / FLOATS_PER_POINT);
  }

  resizeCanvas();
  render();
};
