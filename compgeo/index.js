window.onload = function() {
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
    attribute vec3 a_color;
    uniform vec2 u_resolution;
    varying vec3 v_color;

    void main() {
      vec2 zeroToOne = a_position / u_resolution;
      vec2 clipSpace = zeroToOne * 2.0 - 1.0;

      gl_Position = vec4(clipSpace * vec2(1, -1), 0, 1);
      gl_PointSize = 5.0;
      v_color = a_color;
    }
  `;

  const fragmentShaderSource = `
    precision mediump float;

    uniform float u_isPoint;
    varying vec3 v_color;

    void main() {
      if (u_isPoint > 0.5) {
        // Round, antialiased point
        vec2 coord = gl_PointCoord * 2.0 - 1.0;
        float dist = length(coord);
        if (dist > 1.0) discard;
        float alpha = 1.0 - smoothstep(0.8, 1.0, dist);
        gl_FragColor = vec4(v_color, alpha);
      } else {
        // Solid line fragment
        gl_FragColor = vec4(v_color, 1.0);
      }
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
  const resolutionUniformLocation = gl.getUniformLocation(
    program,
    "u_resolution",
  );
  const isPointUniformLocation = gl.getUniformLocation(program, "u_isPoint");

  const FLOATS_PER_POINT = 2; // x, y
  const POINT_COLOR = [0.0, 0.0, 1.0]; // default blue

  // current generator
  let algorithm = null;
  let algorithmDone = false;

  // Data storage
  let pointsData = []; // { x, y }
  let linesData = []; // { x1, y1, x2, y2, color: [r,g,b] }

  const pointBuffer = gl.createBuffer();
  const lineBuffer = gl.createBuffer();

  /* ---------------- helpers ---------------- */

  function parseColor(color) {
    // Accept [r, g, b] with 0..1 floats, or a hex string "#rrggbb".
    if (Array.isArray(color) && color.length >= 3) {
      return [color[0], color[1], color[2]];
    }
    if (typeof color === "string" && color.startsWith("#")) {
      const hex = color.slice(1);
      if (hex.length === 6) {
        const r = parseInt(hex.slice(0, 2), 16) / 255;
        const g = parseInt(hex.slice(2, 4), 16) / 255;
        const b = parseInt(hex.slice(4, 6), 16) / 255;
        return [r, g, b];
      }
    }
    return POINT_COLOR; // fallback
  }

  /* ---------------- public API ---------------- */

  function addPoint(x, y) {
    pointsData.push({ x, y });
    linesData = [];
    algorithm = null;
    render();
  }

  function addLine(x1, y1, x2, y2, color) {
    linesData.push({
      x1,
      y1,
      x2,
      y2,
      color: parseColor(color),
    });
    render();
  }

  function clearAll() {
    pointsData = [];
    linesData = [];
    algorithm = null;
    render();
  }

  function step() {
    if (algorithm === null) {
      let alg = document.querySelector('input[name="algorithm"]:checked').value;
      let newPoints = structuredClone(pointsData);
      switch (alg) {
        case "graham":
          algorithm = grahams_scan(newPoints);
          break;
        case "brute":
          algorithm = brute_force(newPoints);
          break;
        case "jarvis":
          algorithm = jarvis_march(newPoints);
          break;
      }
    } else if (algorithmDone) {
      render();
      return;
    }

    let next = algorithm.next();
    algorithmDone = next.done;
    if (algorithmDone) {
      return;
    }
    linesData = next.value;
    render();
  }

  window.addPoint = addPoint;
  window.addLine = addLine;
  window.clearAll = clearAll;

  /* ---------------- interaction ---------------- */

  const clearBtn = document.getElementById("clearBtn");
  if (clearBtn) {
    clearBtn.addEventListener("click", clearAll);
  }

  const stepBtn = document.getElementById("stepBtn");
  if (stepBtn) {
    stepBtn.addEventListener("click", step);
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

  function getCanvasCoordinates(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height),
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

  /* ---------------- rendering ---------------- */

  function render() {
    resizeCanvas();

    gl.clearColor(1.0, 1.0, 1.0, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(program);
    gl.uniform2f(resolutionUniformLocation, canvas.width, canvas.height);

    gl.enableVertexAttribArray(positionLocation);
    gl.enableVertexAttribArray(colorLocation);

    // ---- Lines ----
    if (linesData.length > 0) {
      // Interleave: x1, y1, r, g, b,  x2, y2, r, g, b  (10 floats per segment)
      const lineVerts = [];
      for (const line of linesData) {
        const [r, g, b] = line.color;
        lineVerts.push(line.x1, line.y1, r, g, b, line.x2, line.y2, r, g, b);
      }

      gl.uniform1f(isPointUniformLocation, 0.0);
      gl.bindBuffer(gl.ARRAY_BUFFER, lineBuffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array(lineVerts),
        gl.DYNAMIC_DRAW,
      );

      const stride = 5 * 4; // 5 floats (x,y,r,g,b) * 4 bytes
      gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, stride, 0);
      gl.vertexAttribPointer(colorLocation, 3, gl.FLOAT, false, stride, 2 * 4);

      gl.drawArrays(gl.LINES, 0, lineVerts.length / 5);
    }

    // ---- Points ----
    if (pointsData.length > 0) {
      // Interleave: x, y, r, g, b  (5 floats per point)
      const pointVerts = [];
      for (const p of pointsData) {
        pointVerts.push(
          p.x,
          p.y,
          POINT_COLOR[0],
          POINT_COLOR[1],
          POINT_COLOR[2],
        );
      }

      gl.uniform1f(isPointUniformLocation, 1.0);
      gl.bindBuffer(gl.ARRAY_BUFFER, pointBuffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array(pointVerts),
        gl.DYNAMIC_DRAW,
      );

      const stride = 5 * 4;
      gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, stride, 0);
      gl.vertexAttribPointer(colorLocation, 3, gl.FLOAT, false, stride, 2 * 4);

      gl.drawArrays(gl.POINTS, 0, pointsData.length);
    }
  }

  function orient(p1, p2, p3) {
    return (p2.x - p1.x) * (p3.y - p1.y) - (p2.y - p1.y) * (p3.x - p1.x);
  }

  function* grahams_scan(points) {
    if (points.length < 3) {
      return;
    }

    const green = [0.0, 1.0, 0.0];
    const red = [1.0, 0.0, 0.0];

    function makeLines(hull, point = null, color = [0.0, 0.0, 0.0]) {
      let lines = [];
      for (i = 0; i < hull.length - 1; i++) {
        let p1 = hull.at(i);
        let p2 = hull.at(i + 1);
        lines.push({
          x1: p1.x,
          y1: p1.y,
          x2: p2.x,
          y2: p2.y,
          color: parseColor(color),
        });
      }
      if (point !== null) {
        let p1 = hull.at(-1);
        lines.push({
          x1: p1.x,
          y1: p1.y,
          x2: point.x,
          y2: point.y,
          color: parseColor(red),
        });
      }
      return lines;
    }

    points.sort((a, b) => a.x - b.x);
    let topHull = [];
    let topPoints = structuredClone(points);
    topHull.push(topPoints.pop());
    topHull.push(topPoints.pop());
    yield makeLines(topHull);
    while (true) {
      let pt = topPoints.pop();
      if (pt === undefined) {
        break;
      }

      while (
        topHull.length >= 2 &&
        orient(topHull.at(-2), topHull.at(-1), pt) > 0
      ) {
        yield makeLines(topHull, pt);
        topHull.pop();
      }

      topHull.push(pt);
      yield makeLines(topHull);
    }

    yield makeLines(topHull, null, green);

    let bottomHull = [];
    bottomHull.push(points.pop());
    bottomHull.push(points.pop());
    yield makeLines(topHull, null, green).concat(makeLines(bottomHull));
    while (true) {
      let pt = points.pop();
      if (pt === undefined) {
        break;
      }

      while (
        bottomHull.length >= 2 &&
        orient(bottomHull.at(-2), bottomHull.at(-1), pt) < 0
      ) {
        yield makeLines(topHull, null, green).concat(makeLines(bottomHull, pt));
        bottomHull.pop();
      }

      bottomHull.push(pt);
      yield makeLines(topHull, null, green).concat(makeLines(bottomHull));
    }

    yield makeLines(topHull, null, green).concat(
      makeLines(bottomHull, null, green),
    );
  }

  function* brute_force(points) {
    while (true) {
      console.log("Brute force algorithm unsupported.");
      yield [];
    }
  }

  function* jarvis_march(points) {
    while (true) {
      console.log("Jarvis's march algorithm unsupported.");
      yield [];
    }
  }

  resizeCanvas();
  render();
};
