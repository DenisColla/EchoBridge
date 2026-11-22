// Procedural sky dome: gradient by time of day, sun disc + glow, moon, stars,
// procedural clouds. Centered on the camera every frame (never reachable), drawn
// first. Flagged userData.isGround so the render pipeline treats it like the
// floor: drawn before the ink (never inked, outlines of objects against it stay
// intact), a shadow catcher (= invisible) in transparent exports.
// Style modes: 0 realistic, 1 clay (neutral, desaturated), 2 toon (flat bands).
import * as THREE from 'three';

const VERT = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = normalize( position );
    vec4 mv = modelViewMatrix * vec4( position, 1.0 );
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */`
  uniform vec3 uZenith, uHorizon, uBelow, uSunGlow, uSunDir, uMoonDir, uCloudLit, uCloudDark;
  uniform float uSunVis, uMoonVis, uStars, uCloud, uCloudShade, uHaze, uMode, uSeed;
  varying vec3 vDir;

  float hash12( vec2 p ) { vec3 p3 = fract( vec3( p.xyx ) * 0.1031 ); p3 += dot( p3, p3.yzx + 33.33 ); return fract( ( p3.x + p3.y ) * p3.z ); }
  float vnoise( vec2 p ) {
    vec2 i = floor( p ), f = fract( p );
    vec2 u = f * f * ( 3.0 - 2.0 * f );
    return mix( mix( hash12( i ), hash12( i + vec2( 1.0, 0.0 ) ), u.x ), mix( hash12( i + vec2( 0.0, 1.0 ) ), hash12( i + vec2( 1.0, 1.0 ) ), u.x ), u.y );
  }
  float fbm( vec2 p ) {
    float s = 0.0, a = 0.5;
    for ( int i = 0; i < 5; i ++ ) { s += a * vnoise( p ); p = p * 2.03 + vec2( 17.1, 9.2 ); a *= 0.5; }
    return s;
  }
  vec3 desat( vec3 c, float k ) { float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ); return mix( c, vec3( l ), k ); }

  void main() {
    vec3 d = normalize( vDir );
    float h = d.y;
    // ---- gradient (a little brighter haze band just above the horizon)
    float t = pow( clamp( h, 0.0, 1.0 ), 0.42 );
    vec3 col = mix( uHorizon, uZenith, t );
    col = mix( col, uHorizon * 1.04, ( 1.0 - smoothstep( 0.0, 0.12, h ) ) * uHaze * 0.6 );
    // below the horizon: towards the far ground colour (terrain usually covers it)
    col = mix( col, uBelow, smoothstep( 0.0, -0.08, h ) );
    // ---- sun glow (also when the sun is just below the horizon: dusk band)
    float sd = dot( d, uSunDir );
    float glowK = clamp( uSunDir.y * 4.0 + 1.0, 0.0, 1.0 );
    float glow = pow( max( sd, 0.0 ), 6.0 ) * 0.45 + pow( max( sd, 0.0 ), 64.0 ) * 0.6;
    float horizonBand = pow( max( dot( normalize( vec3( d.x, 0.0, d.z ) + 1e-4 ), normalize( vec3( uSunDir.x, 0.0, uSunDir.z ) + 1e-4 ) ), 0.0 ), 3.0 ) * ( 1.0 - smoothstep( 0.0, 0.35, abs( h ) ) );
    col += uSunGlow * ( glow * glowK * uSunVis + horizonBand * 0.35 * glowK ) * ( 1.0 - uCloud * 0.6 );
    // ---- stars
    if ( uStars > 0.001 && h > 0.0 ) {
      vec2 sp = vec2( atan( d.z, d.x ) * 120.0, asin( clamp( h, -1.0, 1.0 ) ) * 120.0 );
      vec2 cell = floor( sp );
      float r = hash12( cell + uSeed );
      if ( r > 0.985 ) {
        vec2 o = vec2( hash12( cell * 1.7 + 3.1 ), hash12( cell * 2.3 + 7.7 ) );
        float dd = length( fract( sp ) - o );
        float star = smoothstep( 0.18, 0.0, dd ) * ( r - 0.985 ) * 66.0;
        col += vec3( 0.9, 0.95, 1.0 ) * star * uStars * smoothstep( 0.0, 0.15, h );
      }
    }
    // ---- sun / moon discs
    float sunDisc = smoothstep( 0.99965, 0.99985, sd ) * uSunVis;
    col = mix( col, uSunGlow * 3.0 + vec3( 1.2 ), sunDisc * ( 1.0 - uCloud * 0.9 ) );
    float md = dot( d, uMoonDir );
    float moon = smoothstep( 0.99935, 0.99955, md ) * uMoonVis;
    if ( moon > 0.0 ) {
      float spots = vnoise( d.xz * 900.0 ) * 0.25 + vnoise( d.xy * 400.0 ) * 0.2;
      col = mix( col, vec3( 0.95, 0.95, 0.88 ) * ( 1.05 - spots ), moon * ( 1.0 - uCloud * 0.8 ) );
    }
    col += vec3( 0.55, 0.62, 0.8 ) * pow( max( md, 0.0 ), 400.0 ) * 0.35 * uMoonVis;
    // ---- clouds: noise on a virtual plane above the camera
    if ( uCloud > 0.001 && h > -0.02 ) {
      vec2 uv = d.xz / ( max( h, 0.0 ) + 0.09 ) * 0.42 + vec2( uSeed * 0.37, uSeed * 0.21 );
      float n = fbm( uv );
      float cov = mix( 0.78, 0.18, uCloud );
      float c = smoothstep( cov, cov + 0.22, n );
      if ( uMode > 1.5 ) c = step( cov + 0.06, n ); // toon: hard-edged shapes
      float thick = smoothstep( cov, cov + 0.5, n );
      vec3 cc = mix( uCloudLit, uCloudDark, clamp( thick * uCloudShade + uCloud * 0.25, 0.0, 1.0 ) );
      cc += uSunGlow * pow( max( sd, 0.0 ), 8.0 ) * 0.4 * glowK; // sun-lit rims
      float fade = smoothstep( -0.02, 0.12, h );
      col = mix( col, cc, c * fade * mix( 0.85, 1.0, uCloud ) );
    }
    // ---- style modes
    if ( uMode > 0.5 && uMode < 1.5 ) col = desat( col, 0.72 ) * 0.95 + 0.04; // clay: neutral studio sky
    if ( uMode > 1.5 ) { // toon: three flat bands of the gradient
      float b = h < 0.12 ? 0.0 : h < 0.38 ? 0.5 : 1.0;
      vec3 bandCol = mix( uHorizon, uZenith, b );
      col = mix( bandCol, col, 0.25 );
    }
    gl_FragColor = vec4( max( col, vec3( 0.0 ) ), 1.0 );
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const lin = (hex, out = new THREE.Color()) => out.set(hex); // THREE.Color converts sRGB hex to the linear working space

export class SkyDome {
  constructor() {
    const geo = new THREE.SphereGeometry(1800, 48, 24);
    this.uniforms = {
      uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uBelow: { value: new THREE.Color() },
      uSunGlow: { value: new THREE.Color() }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
      uCloudLit: { value: new THREE.Color() }, uCloudDark: { value: new THREE.Color() },
      uSunVis: { value: 1 }, uMoonVis: { value: 0 }, uStars: { value: 0 }, uCloud: { value: 0.2 }, uCloudShade: { value: 0.5 },
      uHaze: { value: 0.3 }, uMode: { value: 0 }, uSeed: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG,
      side: THREE.BackSide, depthWrite: false, fog: false,
    });
    mat.name = 'pv:landscape:sky';
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'landscape:sky';
    mesh.frustumCulled = false;
    mesh.renderOrder = -1000;
    mesh.userData.isGround = true; // pipeline: background layer, never inked
    mesh.userData.landscape = 'sky';
    mesh.castShadow = false; mesh.receiveShadow = false;
    mesh.raycast = () => {};
    // follow the camera (also during captures and G-buffer passes)
    mesh.onBeforeRender = (renderer, scene, camera) => {
      mesh.matrixWorld.makeTranslation(camera.position.x, camera.position.y, camera.position.z);
    };
    this.mesh = mesh;
  }

  /** atm: atmosphere() result; sunDir / moonDir: world unit vectors. */
  set(atm, sunDir, moonDir, belowHex, seed) {
    const u = this.uniforms, s = atm.sky;
    lin(s.zenith, u.uZenith.value);
    lin(s.horizon, u.uHorizon.value);
    lin(belowHex, u.uBelow.value);
    lin(s.sunGlow, u.uSunGlow.value);
    u.uSunDir.value.copy(sunDir);
    u.uMoonDir.value.copy(moonDir);
    u.uSunVis.value = s.sunVisible ? 1 : 0;
    u.uMoonVis.value = s.moon ? 1 : 0;
    u.uStars.value = s.stars;
    u.uCloud.value = s.cloud;
    u.uCloudShade.value = 0.35 + s.cloudDark;
    u.uHaze.value = s.haze;
    u.uSeed.value = (seed % 997) * 0.731;
    // cloud colours follow the light: white by day, warm at dusk, slate at night
    const lit = atm.night ? '#3a4562' : atm.dusk ? '#9b8fb0' : atm.time === 'tramonto' || atm.time === 'alba' ? '#ffd6b8' : '#ffffff';
    const dark = atm.night ? '#141a2c' : atm.dusk ? '#3e4266' : atm.weather === 'pioggia' ? '#4a515c' : atm.time === 'tramonto' ? '#7c6a8a' : '#9aa3b0';
    lin(lit, u.uCloudLit.value);
    lin(dark, u.uCloudDark.value);
  }

  setMode(style) {
    this.uniforms.uMode.value = style === 'clay' ? 1 : style === 'toon' ? 2 : 0;
    this.mesh.visible = style !== 'lines';
  }

  dispose() { this.mesh.geometry.dispose(); this.mesh.material.dispose(); this.mesh.removeFromParent(); }
}
