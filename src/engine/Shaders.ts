import * as THREE from 'three';

export function createFogGateMaterial(colorHex: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(colorHex) },
      uIntensity: { value: 1.0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float uTime;
      uniform vec3 uColor;
      uniform float uIntensity;
      varying vec2 vUv;

      void main() {
        float w1 = sin(vUv.y * 9.0 - uTime * 2.1 + sin(vUv.x * 5.0 + uTime));
        float w2 = cos(vUv.x * 11.0 + uTime * 1.4 - vUv.y * 6.0);
        float mist = 0.5 + 0.25 * w1 + 0.25 * w2;
        float edgeX = smoothstep(0.0, 0.22, vUv.x) * smoothstep(1.0, 0.78, vUv.x);
        float edgeY = smoothstep(0.0, 0.14, vUv.y) * smoothstep(1.0, 0.75, vUv.y);
        float alpha = mist * edgeX * edgeY * 0.72 * uIntensity;
        vec3 col = mix(uColor, vec3(0.95, 0.85, 0.62), smoothstep(0.65, 1.0, mist) * 0.45);
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });
}

export function createWardShellMaterial(colorHex: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(colorHex) },
      uPulse: { value: 0.5 },
      uOpacity: { value: 0.85 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorldNormal;
      varying vec3 vViewDir;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        vViewDir = normalize(cameraPosition - worldPos.xyz);
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float uTime;
      uniform vec3 uColor;
      uniform float uPulse;
      uniform float uOpacity;
      varying vec3 vWorldNormal;
      varying vec3 vViewDir;
      varying vec2 vUv;

      void main() {
        vec3 n = normalize(vWorldNormal);
        vec3 v = normalize(vViewDir);
        float fresnel = pow(1.0 - clamp(abs(dot(n, v)), 0.0, 1.0), 2.4);
        float lattice = 0.5 + 0.5 * sin(vUv.y * 28.0 - uTime * 3.5) * cos(vUv.x * 18.0 + uTime * 2.0);
        float alpha = clamp((fresnel * 0.85 + lattice * 0.22 * uPulse) * uOpacity, 0.0, 0.95);
        vec3 col = uColor * (0.85 + 0.55 * uPulse) + vec3(0.95, 0.84, 0.58) * fresnel * 0.35;
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });
}

