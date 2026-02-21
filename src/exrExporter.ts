import * as THREE from 'three';
import { EXRExporter } from 'three/examples/jsm/exporters/EXRExporter.js';

export async function exportToEXR(data: Float32Array, width: number, height: number): Promise<Blob> {
  const exporter = new EXRExporter();
  
  // Create a data texture from the elevation data
  // EXR usually expects 4 channels (RGBA) or 1 channel (Luminance)
  // We'll use Red channel for elevation
  const textureData = new Float32Array(width * height * 4);
  for (let i = 0; i < data.length; i++) {
    textureData[i * 4] = data[i];     // R
    textureData[i * 4 + 1] = data[i]; // G
    textureData[i * 4 + 2] = data[i]; // B
    textureData[i * 4 + 3] = 1.0;     // A
  }

  const texture = new THREE.DataTexture(
    textureData,
    width,
    height,
    THREE.RGBAFormat,
    THREE.FloatType
  );
  texture.needsUpdate = true;

  // EXRExporter.parse expects a WebGLRenderer and a WebGLRenderTarget
  // or it can take a DataTexture in some versions, but usually it's used with render targets.
  // However, we can use a simpler approach if we just want the raw EXR bytes.
  
  const renderer = new THREE.WebGLRenderer();
  const renderTarget = new THREE.WebGLRenderTarget(width, height, {
    format: THREE.RGBAFormat,
    type: THREE.FloatType,
  });

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const geometry = new THREE.PlaneGeometry(2, 2);
  const material = new THREE.MeshBasicMaterial({ map: texture });
  const mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);

  renderer.setRenderTarget(renderTarget);
  renderer.render(scene, camera);

  const exrData = await exporter.parse(renderer, renderTarget);
  
  renderer.dispose();
  renderTarget.dispose();
  texture.dispose();
  geometry.dispose();
  material.dispose();

  return new Blob([exrData as any], { type: 'image/x-exr' });
}
