/* Independently authored shader presets. Never evaluates user-supplied source.
 * Two preset kinds share one library:
 *  - legacy presets (aurora … swirl): one colour (node.color/token) + speed + intensity, original program.
 *  - parametric presets (Tidal Swirl, Ripple Pool, Pixel Bloom, Signal Grid families): four colours
 *    (center, edge, ripple, background; each `{color, token?}` in node.shaderColors) and five 0–100 sliders
 *    (aspect, size, density, distortion, grain in node.shaderParams); speed stays node.shaderSpeed (0–5).
 * Shader layers use them as their content; any other layer with `shaderFill: true` (Shader mode) paints its fill
 * with them, under its children (mount() prepends the surface at z-index -1 in an isolated element).
 * Absent fields fall back to the preset defaults. The library loads in Node too (no DOM access at load). */
(function installBetterShaders(global) {
  "use strict";
  function createShaderLibrary() {
    const HEX = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;
    const NAME = /^[a-zA-Z0-9][a-zA-Z0-9_./ -]{0,99}$/;
    const COLOR_ROLES = ["center", "edge", "ripple", "background"];
    const PARAM_KEYS = ["aspect", "size", "density", "distortion", "grain"];
    const PATTERNS = { "Tidal Swirl": 0, "Ripple Pool": 1, "Pixel Bloom": 2, "Signal Grid": 3 };
    const legacy = (id, name) => ({
      id,
      name,
      family: "Classic",
      kind: "legacy",
      defaults: { speed: 1 },
    });
    const param = (
      family,
      n,
      center,
      edge,
      ripple,
      background,
      aspect,
      size,
      density,
      speed,
      distortion,
      grain,
    ) => ({
      id: family.toLowerCase().replace(/\s+/g, "-") + "-" + n,
      name: family + " " + n,
      family,
      kind: "param",
      pattern: PATTERNS[family],
      defaults: {
        colors: { center, edge, ripple, background },
        aspect,
        size,
        density,
        speed,
        distortion,
        grain,
      },
    });
    // Catalog order is the picker order. Colours/values are this library's own choices.
    const PRESETS = [
      param("Tidal Swirl", 1, "#3f5fa8", "#121a33", "#ffffff", "#000000", 20, 75, 18, 1.2, 35, 12),
      param("Tidal Swirl", 2, "#b04fd8", "#2a0f40", "#ffd8f4", "#08020f", 35, 65, 26, 0.8, 50, 18),
      param("Tidal Swirl", 3, "#2fb5a3", "#0b2b2f", "#e6fff9", "#020a0b", 50, 80, 14, 1.5, 25, 8),
      param("Tidal Swirl", 4, "#f08a3c", "#3b1408", "#fff1d6", "#120502", 45, 60, 32, 1, 60, 20),
      param("Ripple Pool", 1, "#5a8cff", "#0d1640", "#c9dcff", "#02040f", 50, 70, 30, 1, 20, 10),
      param("Ripple Pool", 2, "#ff5f8f", "#3a0b1d", "#ffe0ea", "#0f0206", 50, 55, 45, 0.7, 30, 15),
      param("Ripple Pool", 3, "#9be15d", "#163312", "#f4ffe6", "#030a02", 30, 85, 20, 1.3, 15, 6),
      param("Pixel Bloom", 1, "#7c5cff", "#160d3d", "#ffffff", "#05030f", 50, 70, 40, 1, 10, 0),
      param("Pixel Bloom", 2, "#00c2ff", "#002233", "#b8f3ff", "#000a10", 50, 60, 55, 1.6, 20, 5),
      param("Pixel Bloom", 3, "#ffcc33", "#3d2a00", "#fff6d6", "#0d0900", 50, 80, 30, 0.6, 0, 10),
      param("Signal Grid", 1, "#33d6a6", "#04261c", "#d6fff2", "#010805", 50, 75, 35, 0.8, 30, 8),
      param("Signal Grid", 2, "#5d7bff", "#0a1238", "#e0e6ff", "#02040c", 50, 65, 50, 1.2, 45, 12),
      param("Signal Grid", 3, "#ff7a59", "#3a120a", "#ffe6de", "#0c0302", 50, 85, 25, 1, 15, 4),
      legacy("aurora", "Aurora"),
      legacy("ribbon", "Glass ribbon"),
      legacy("mesh", "Mesh flow"),
      legacy("waves", "Waves"),
      legacy("noise", "Soft noise"),
      legacy("swirl", "Swirl"),
    ];
    const LEGACY_ORDER = ["aurora", "waves", "noise", "ribbon", "mesh", "swirl"];
    const presetIds = PRESETS.map((p) => p.id);
    const presetOf = (id) =>
      PRESETS.find((p) => p.id === id) || PRESETS.find((p) => p.id === "aurora");
    const isObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);
    const inRange = (v, min, max) =>
      typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;

    /** '' when the shader fields of a layer are valid, else a message (mentions "shader"). */
    function validate(node) {
      if (!node || typeof node !== "object") return "Invalid shader layer";
      if (node.shaderPreset !== undefined && !presetIds.includes(node.shaderPreset))
        return "Invalid shader preset";
      // Shader mode (Wonder H6): any non-shader layer may paint its fill with the shader fields below.
      if (
        node.shaderFill !== undefined &&
        (typeof node.shaderFill !== "boolean" || (node.shaderFill && node.type === "shader"))
      )
        return "Invalid shader mode";
      if (node.shaderColors !== undefined) {
        if (!isObject(node.shaderColors)) return "Invalid shader colours";
        for (const [role, c] of Object.entries(node.shaderColors)) {
          if (!COLOR_ROLES.includes(role) || !isObject(c) || !HEX.test(String(c.color || "")))
            return "Invalid shader colour " + role;
          if (
            c.token !== undefined &&
            (typeof c.token !== "string" || (c.token !== "" && !NAME.test(c.token)))
          )
            return "Invalid shader colour variable " + role;
        }
      }
      if (node.shaderParams !== undefined) {
        if (!isObject(node.shaderParams)) return "Invalid shader parameters";
        for (const [key, v] of Object.entries(node.shaderParams))
          if (!PARAM_KEYS.includes(key) || !inRange(v, 0, 100))
            return "Invalid shader parameter " + key;
      }
      return "";
    }

    /**
     * Effective parameters for a layer. Legacy presets: {kind:'legacy', preset}. Parametric presets: every colour
     * resolved (a bound Colors variable wins while it resolves), every slider filled from the preset defaults.
     */
    function resolve(node, tokens) {
      const preset = presetOf(node?.shaderPreset || "aurora");
      if (preset.kind !== "param") return { kind: "legacy", preset: preset.id };
      const d = preset.defaults,
        out = { kind: "param", preset: preset.id, pattern: preset.pattern, colors: {} };
      for (const role of COLOR_ROLES) {
        const c = node?.shaderColors?.[role];
        const bound = c?.token && tokens && HEX.test(tokens[c.token] || "") ? tokens[c.token] : "";
        out.colors[role] = (
          bound || (HEX.test(c?.color || "") ? c.color : d.colors[role])
        ).toLowerCase();
      }
      for (const key of PARAM_KEYS)
        out[key] = inRange(node?.shaderParams?.[key], 0, 100) ? node.shaderParams[key] : d[key];
      out.speed = inRange(node?.shaderSpeed, 0, 5) ? node.shaderSpeed : d.speed;
      return out;
    }

    const vertex = "attribute vec2 a_position;void main(){gl_Position=vec4(a_position,0.0,1.0);}";
    const fragment = `precision mediump float;
uniform vec2 u_resolution;uniform float u_time;uniform float u_intensity;uniform vec3 u_color;uniform int u_preset;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);}
void main(){vec2 uv=gl_FragCoord.xy/u_resolution;float t=u_time;float field;
if(u_preset==0){field=.5+.5*sin(uv.x*7.+sin(uv.y*5.+t)*1.7+t*.7);field=mix(field,noise(uv*4.+vec2(t*.14,0.)),.35);}
else if(u_preset==1){float wave=sin(uv.x*12.+t*1.4)+sin(uv.y*9.-t*.8);field=.5+.25*wave;}
else if(u_preset==2){field=noise(uv*5.+vec2(t*.18,t*.1))*.65+noise(uv*13.-t*.11)*.35;}
else if(u_preset==3){field=pow(.5+.5*sin(uv.x*18.+sin(uv.y*6.+t)*5.),3.);}
else if(u_preset==4){field=.5+.25*sin(uv.x*6.+t+sin(uv.y*5.))+.25*cos(uv.y*7.-t*.7);}
else{vec2 p=uv-.5;field=.5+.5*sin(atan(p.y,p.x)*4.+length(p)*18.-t);}
vec3 secondary=clamp(vec3(u_color.b*.8+.2,u_color.r*.6+.25,u_color.g*.8+.15),0.,1.);
vec3 base=mix(u_color,secondary,clamp(field*u_intensity,0.,1.));float glow=.65+.45*field*u_intensity;
gl_FragColor=vec4(clamp(base*glow+vec3(.06)*(1.-uv.y),0.,1.),1.);}`;
    // Parametric program: background, then a radial centre→edge gradient warped by noise, then a pattern in the
    // ripple colour (0 swirl arms, 1 concentric ripples, 2 pixel cells, 3 grid lines), then film grain.
    // Output is premultiplied alpha so translucent colours composite over the canvas.
    const paramFragment = `precision mediump float;
uniform vec2 u_resolution;uniform float u_time;uniform int u_pattern;
uniform vec4 u_center;uniform vec4 u_edge;uniform vec4 u_ripple;uniform vec4 u_background;
uniform float u_aspect;uniform float u_size;uniform float u_density;uniform float u_distortion;uniform float u_grain;
float hash(vec2 p){return fract(sin(dot(p,vec2(41.37,289.13)))*24634.6345);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);}
vec4 over(vec4 top,vec4 below){return vec4(top.rgb*top.a+below.rgb*(1.-top.a),top.a+below.a*(1.-top.a));}
void main(){vec2 uv=gl_FragCoord.xy/u_resolution;float t=u_time;
vec2 p=uv-.5;p.x*=u_resolution.x/u_resolution.y;p.x*=mix(.35,2.2,u_aspect);
vec2 warp=vec2(noise(p*2.6+vec2(t*.21,-t*.13)),noise(p*2.6+vec2(5.2-t*.17,1.7+t*.11)))-.5;
vec2 q=p+warp*u_distortion*.9;
float r=length(q)/mix(.12,1.1,u_size);
vec4 grad=mix(u_center,u_edge,smoothstep(0.,1.,r));
float d=mix(3.,46.,u_density);float m;
if(u_pattern==0){float a=atan(q.y,q.x);m=.5+.5*sin(length(q)*d-a*3.+t*1.3);m=smoothstep(.72,.98,m);}
else if(u_pattern==1){m=.5+.5*sin(length(q)*d-t*2.2);m=smoothstep(.8,1.,m)*(1.-smoothstep(.2,1.3,r));}
else if(u_pattern==2){vec2 cell=floor((q+.5)*d*1.6);float h=hash(cell+floor(t*1.5)*.37);float pulse=.5+.5*sin(t*2.+h*6.28);m=step(.78,h)*pulse;}
else{vec2 g=abs(fract(q*d*.45+vec2(t*.04,t*.03))-.5);float line=1.-smoothstep(0.,.05,min(g.x,g.y));float node=1.-smoothstep(0.,.12,length(g-.5));m=max(line*.6,node)*(.4+.6*noise(q*3.+t*.3));}
vec4 bg=vec4(u_background.rgb,u_background.a);
vec4 col=over(vec4(grad.rgb,grad.a),bg);
col=over(vec4(u_ripple.rgb,u_ripple.a*clamp(m,0.,1.)),col);
float g=(hash(gl_FragCoord.xy+fract(t)*91.7)-.5)*u_grain*.35;
col.rgb=clamp(col.rgb+g,0.,1.);
gl_FragColor=vec4(col.rgb*col.a,col.a);}`;
    const rgba = (hex) =>
      [1, 3, 5]
        .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
        .concat(hex.length === 9 ? parseInt(hex.slice(7, 9), 16) / 255 : 1);
    const active = new WeakMap();
    function readParams(params, element) {
      if (isObject(params.resolved)) return params.resolved;
      const raw = element.dataset.shaderParams;
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (isObject(parsed) && parsed.kind === "param") return parsed;
        } catch {}
      }
      const preset = presetOf(params.preset || element.dataset.shaderPreset || "aurora");
      return preset.kind === "param"
        ? resolve({ shaderPreset: preset.id, shaderSpeed: params.speed }, null)
        : null;
    }
    function mount(element, params = {}) {
      active.get(element)?.();
      const canvas = document.createElement("canvas");
      canvas.className = "shader-surface";
      canvas.setAttribute(
        "aria-label",
        "Animated WebGL " + (params.preset || element.dataset.shaderPreset || "aurora") + " shader",
      );
      // Shader mode on a box (data-shader-fill): the surface paints the fill, under the layer's own content.
      const fill = element.dataset.shaderFill === "true";
      canvas.style.cssText =
        "position:absolute;inset:0;width:100%;height:100%;border-radius:inherit;pointer-events:none;" +
        (fill ? "z-index:-1;" : "");
      if (fill) {
        element.style.isolation = "isolate";
        element.prepend(canvas);
      } else element.append(canvas);
      const resolved = readParams(params, element);
      let gl,
        program,
        buffer,
        frame = 0,
        closed = false,
        observer;
      const shaders = [];
      function fallback(message) {
        element.dataset.shaderStatus = "unavailable";
        canvas.remove();
        if (fill) return () => {};
        const label = document.createElement("span");
        label.className = "shader-fallback";
        label.textContent = message;
        label.style.cssText =
          "position:absolute;inset:8px;font:11px system-ui;color:inherit;pointer-events:none;";
        element.append(label);
        return () => label.remove();
      }
      try {
        gl = canvas.getContext("webgl", {
          alpha: !!resolved,
          antialias: false,
          preserveDrawingBuffer: true,
          powerPreference: "low-power",
        });
      } catch {}
      if (!gl) {
        const close = fallback("WebGL unavailable · solid color fallback");
        active.set(element, close);
        return close;
      }
      try {
        const compile = (type, source) => {
          const shader = gl.createShader(type);
          gl.shaderSource(shader, source);
          gl.compileShader(shader);
          shaders.push(shader);
          if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
            throw Error("Shader compilation unavailable");
          return shader;
        };
        program = gl.createProgram();
        gl.attachShader(program, compile(gl.VERTEX_SHADER, vertex));
        gl.attachShader(program, compile(gl.FRAGMENT_SHADER, resolved ? paramFragment : fragment));
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS))
          throw Error("Shader linking unavailable");
        gl.useProgram(program);
        buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(
          gl.ARRAY_BUFFER,
          new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
          gl.STATIC_DRAW,
        );
        const position = gl.getAttribLocation(program, "a_position");
        gl.enableVertexAttribArray(position);
        gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
        const uniform = (name) => gl.getUniformLocation(program, name);
        const resolution = uniform("u_resolution"),
          time = uniform("u_time");
        const clamp = (value, min, max, fallback) =>
          Number.isFinite(Number(value)) ? Math.min(max, Math.max(min, Number(value))) : fallback;
        let speed;
        if (resolved) {
          speed = clamp(params.speed ?? resolved.speed, 0, 5, 1);
          gl.uniform1i(uniform("u_pattern"), clamp(resolved.pattern, 0, 3, 0));
          for (const role of COLOR_ROLES) {
            const c = HEX.test(resolved.colors?.[role] || "") ? resolved.colors[role] : "#000000";
            gl.uniform4fv(uniform("u_" + role), rgba(c));
          }
          for (const key of PARAM_KEYS)
            gl.uniform1f(uniform("u_" + key), clamp(resolved[key], 0, 100, 50) / 100);
          element.dataset.shaderKind = "param";
        } else {
          speed = clamp(params.speed ?? element.dataset.shaderSpeed, 0, 5, 1);
          const strength = clamp(params.intensity ?? element.dataset.shaderIntensity, 0, 2, 1);
          const color = /^#[0-9a-f]{6}$/i.test(params.color || element.dataset.shaderColor || "")
            ? params.color || element.dataset.shaderColor
            : "#a58bdd";
          const preset = params.preset || element.dataset.shaderPreset || "aurora";
          gl.uniform1i(uniform("u_preset"), Math.max(0, LEGACY_ORDER.indexOf(preset)));
          gl.uniform1f(uniform("u_intensity"), strength);
          gl.uniform3f(
            uniform("u_color"),
            parseInt(color.slice(1, 3), 16) / 255,
            parseInt(color.slice(3, 5), 16) / 255,
            parseInt(color.slice(5, 7), 16) / 255,
          );
        }
        const reduced =
          globalThis.appPreferences?.get?.().reduceMotion === true ||
          (typeof matchMedia === "function" &&
            matchMedia("(prefers-reduced-motion: reduce)").matches);
        const start = performance.now();
        function draw(now) {
          if (closed) return;
          const width = Math.max(
              1,
              Math.min(1600, Math.round(element.clientWidth * Math.min(devicePixelRatio || 1, 2))),
            ),
            height = Math.max(
              1,
              Math.min(1200, Math.round(element.clientHeight * Math.min(devicePixelRatio || 1, 2))),
            );
          if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
          }
          gl.viewport(0, 0, width, height);
          gl.uniform2f(resolution, width, height);
          gl.uniform1f(time, reduced ? 0 : (now - start) * 0.001 * speed);
          gl.drawArrays(gl.TRIANGLES, 0, 6);
          element.dataset.shaderStatus = "ready";
          if (!reduced && speed > 0) frame = requestAnimationFrame(draw);
        }
        draw(start);
        if (typeof ResizeObserver === "function") {
          observer = new ResizeObserver(() => {
            if (reduced || speed === 0) draw(performance.now());
          });
          observer.observe(element);
        }
        let clearLost;
        const lost = (event) => {
          event.preventDefault();
          cancelAnimationFrame(frame);
          clearLost = fallback("WebGL context lost · solid color fallback");
        };
        canvas.addEventListener("webglcontextlost", lost);
        const close = () => {
          if (closed) return;
          closed = true;
          cancelAnimationFrame(frame);
          clearLost?.();
          observer?.disconnect();
          canvas.removeEventListener("webglcontextlost", lost);
          gl.deleteBuffer(buffer);
          gl.deleteProgram(program);
          shaders.forEach((s) => gl.deleteShader(s));
          gl.getExtension("WEBGL_lose_context")?.loseContext();
          canvas.remove();
          active.delete(element);
        };
        active.set(element, close);
        return close;
      } catch {
        if (buffer) gl.deleteBuffer(buffer);
        if (program) gl.deleteProgram(program);
        shaders.forEach((s) => gl.deleteShader(s));
        gl.getExtension("WEBGL_lose_context")?.loseContext();
        const close = fallback("WebGL shader unavailable · solid color fallback");
        active.set(element, close);
        return close;
      }
    }
    function startAll(root = document) {
      return Array.from(root.querySelectorAll("[data-shader-preset]"), (element) => mount(element));
    }
    /** JSON for the data-shader-params attribute (canvas and HTML export), or '' for legacy presets. */
    const paramsAttr = (node, tokens) => {
      const r = resolve(node, tokens);
      return r.kind === "param" ? JSON.stringify(r) : "";
    };
    return {
      mount,
      startAll,
      PRESETS,
      presetIds,
      COLOR_ROLES,
      PARAM_KEYS,
      presetOf,
      validate,
      resolve,
      paramsAttr,
    };
  }
  global.BetterShaders = {
    ...createShaderLibrary(),
    runtimeSource: () => `(${createShaderLibrary.toString()})().startAll();`,
  };
})(globalThis);
