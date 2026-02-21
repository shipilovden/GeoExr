/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Download, Map as MapIcon, Box, Layers, Loader2, AlertCircle, MousePointer2 } from 'lucide-react';
import { MapContainer, TileLayer, useMap, Rectangle, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { exportToEXR } from './exrExporter';

// Fix Leaflet marker icons
// @ts-ignore
import icon from 'leaflet/dist/images/marker-icon.png';
// @ts-ignore
import iconShadow from 'leaflet/dist/images/marker-shadow.png';

let DefaultIcon = L.icon({
    iconUrl: icon,
    shadowUrl: iconShadow,
    iconSize: [25, 41],
    iconAnchor: [12, 41]
});
L.Marker.prototype.options.icon = DefaultIcon;

// --- Components ---

function SelectionTool({ onSelectionChange }: { onSelectionChange: (bounds: L.LatLngBounds | null) => void }) {
  const [startPos, setStartPos] = useState<L.LatLng | null>(null);
  const [currentPos, setCurrentPos] = useState<L.LatLng | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);

  useMapEvents({
    mousedown(e) {
      if (e.originalEvent.shiftKey) {
        setIsDrawing(true);
        setStartPos(e.latlng);
        setCurrentPos(e.latlng);
        onSelectionChange(null);
      }
    },
    mousemove(e) {
      if (isDrawing) {
        setCurrentPos(e.latlng);
      }
    },
    mouseup() {
      if (isDrawing && startPos && currentPos) {
        const bounds = L.latLngBounds(startPos, currentPos);
        onSelectionChange(bounds);
        setIsDrawing(false);
        setStartPos(null);
        setCurrentPos(null);
      }
    },
  });

  if (isDrawing && startPos && currentPos) {
    return <Rectangle bounds={L.latLngBounds(startPos, currentPos)} pathOptions={{ color: '#3b82f6', weight: 2, fillOpacity: 0.3 }} />;
  }

  return null;
}

export default function App() {
  const previewRef = useRef<HTMLDivElement>(null);
  const [selectionBounds, setSelectionBounds] = useState<L.LatLngBounds | null>(null);
  const [elevationData, setElevationData] = useState<Float32Array | null>(null);
  const [gridSize, setGridSize] = useState({ width: 64, height: 64 });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Three.js refs
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const meshRef = useRef<THREE.Mesh | null>(null);

  // Initialize Three.js Preview
  useEffect(() => {
    if (!previewRef.current) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x09090b); // zinc-950
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(75, previewRef.current.clientWidth / previewRef.current.clientHeight, 0.1, 2000);
    camera.position.set(80, 80, 80);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(previewRef.current.clientWidth, previewRef.current.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    previewRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    // Helpers to see the scene even if mesh is missing
    const gridHelper = new THREE.GridHelper(100, 20, 0x333333, 0x222222);
    scene.add(gridHelper);

    const axesHelper = new THREE.AxesHelper(50);
    scene.add(axesHelper);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.5);
    directionalLight.position.set(50, 100, 50);
    scene.add(directionalLight);

    const animate = () => {
      requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      if (!previewRef.current || !rendererRef.current) return;
      const width = previewRef.current.clientWidth;
      const height = previewRef.current.clientHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      rendererRef.current.setSize(width, height);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      renderer.dispose();
      if (previewRef.current && renderer.domElement.parentNode === previewRef.current) {
        previewRef.current.removeChild(renderer.domElement);
      }
    };
  }, []);

  // Update 3D Mesh when elevation data changes
  useEffect(() => {
    if (!elevationData || !sceneRef.current) return;

    console.log('Updating mesh with data points:', elevationData.length);

    if (meshRef.current) {
      sceneRef.current.remove(meshRef.current);
      meshRef.current.geometry.dispose();
      (meshRef.current.material as THREE.Material).dispose();
    }

    const geometry = new THREE.PlaneGeometry(100, 100, gridSize.width - 1, gridSize.height - 1);
    geometry.rotateX(-Math.PI / 2);

    const vertices = geometry.attributes.position.array as Float32Array;
    
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < elevationData.length; i++) {
      if (elevationData[i] < min) min = elevationData[i];
      if (elevationData[i] > max) max = elevationData[i];
    }
    
    const range = max - min || 1;
    console.log('Elevation range:', min, 'to', max);

    for (let i = 0; i < elevationData.length; i++) {
      // vertices are [x, y, z, x, y, z, ...]
      // after rotateX(-PI/2), y is height
      vertices[i * 3 + 1] = ((elevationData[i] - min) / range) * 30; 
    }

    geometry.computeVertexNormals();

    const material = new THREE.MeshStandardMaterial({
      color: 0x60a5fa, // blue-400
      wireframe: false,
      flatShading: false,
      side: THREE.DoubleSide,
      roughness: 0.4,
      metalness: 0.3
    });

    const mesh = new THREE.Mesh(geometry, material);
    sceneRef.current.add(mesh);
    meshRef.current = mesh;

  }, [elevationData, gridSize]);

  const generateTestLandscape = () => {
    const size = gridSize.width * gridSize.height;
    const data = new Float32Array(size);
    for (let y = 0; y < gridSize.height; y++) {
      for (let x = 0; x < gridSize.width; x++) {
        const val = Math.sin(x * 0.2) * Math.cos(y * 0.2) * 10 + Math.random() * 2;
        data[y * gridSize.width + x] = val;
      }
    }
    setElevationData(data);
  };

  const fetchElevation = useCallback(async () => {
    if (!selectionBounds) return;

    setIsLoading(true);
    setError(null);

    const ne = selectionBounds.getNorthEast();
    const sw = selectionBounds.getSouthWest();

    const latStep = (ne.lat - sw.lat) / (gridSize.height - 1);
    const lngStep = (ne.lng - sw.lng) / (gridSize.width - 1);

    // Prepare points for API
    const locations: { latitude: number, longitude: number }[] = [];
    for (let y = 0; y < gridSize.height; y++) {
      for (let x = 0; x < gridSize.width; x++) {
        locations.push({
          latitude: ne.lat - y * latStep,
          longitude: sw.lng + x * lngStep
        });
      }
    }

    try {
      // Using Open-Elevation API (public, no key required)
      // Note: Large requests might be slow or rejected. 
      // For 64x64 = 4096 points, we might need to chunk.
      const CHUNK_SIZE = 1000;
      const results: number[] = new Array(locations.length);

      for (let i = 0; i < locations.length; i += CHUNK_SIZE) {
        const chunk = locations.slice(i, i + CHUNK_SIZE);
        const response = await fetch('https://api.open-elevation.com/api/v1/lookup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ locations: chunk })
        });

        if (!response.ok) throw new Error('API error');
        const data = await response.json();
        
        data.results.forEach((res: any, index: number) => {
          results[i + index] = res.elevation;
        });
      }

      setElevationData(new Float32Array(results));
    } catch (err: any) {
      console.error(err);
      setError(`Ошибка получения данных: ${err.message}. Попробуйте уменьшить сетку или область.`);
    } finally {
      setIsLoading(false);
    }
  }, [selectionBounds, gridSize]);

  const handleDownload = async () => {
    if (!elevationData) return;
    
    try {
      const blob = await exportToEXR(elevationData, gridSize.width, gridSize.height);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `landscape_${Date.now()}.exr`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export failed:', err);
      setError('Ошибка при экспорте в EXR');
    }
  };

  return (
    <div className="flex flex-col h-screen bg-zinc-950 text-zinc-100 font-sans">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-900/50 backdrop-blur-md z-50">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-600 rounded-lg">
            <Layers className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">GeoExr Free</h1>
            <p className="text-xs text-zinc-500 uppercase tracking-widest font-medium">Open-Source Landscape Exporter</p>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="flex items-center bg-zinc-800 rounded-full px-4 py-1.5 gap-3 border border-zinc-700">
            <span className="text-xs font-mono text-zinc-400">Сетка:</span>
            <select 
              className="bg-transparent text-xs font-mono focus:outline-none cursor-pointer"
              value={gridSize.width}
              onChange={(e) => setGridSize({ width: Number(e.target.value), height: Number(e.target.value) })}
            >
              <option value={32}>32x32</option>
              <option value={64}>64x64</option>
              <option value={128}>128x128 (Медленно)</option>
            </select>
          </div>
          
          <button
            onClick={generateTestLandscape}
            className="flex items-center gap-2 px-5 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-full transition-all font-medium text-sm border border-zinc-700"
          >
            Тест
          </button>

          <button
            onClick={fetchElevation}
            disabled={!selectionBounds || isLoading}
            className="flex items-center gap-2 px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-800 disabled:text-zinc-500 rounded-full transition-all font-medium text-sm shadow-lg shadow-blue-900/20"
          >
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Box className="w-4 h-4" />}
            Обновить превью
          </button>

          <button
            onClick={handleDownload}
            disabled={!elevationData || isLoading}
            className="flex items-center gap-2 px-5 py-2 bg-zinc-100 text-zinc-900 hover:bg-white disabled:bg-zinc-800 disabled:text-zinc-500 rounded-full transition-all font-medium text-sm"
          >
            <Download className="w-4 h-4" />
            Скачать .EXR
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex overflow-hidden">
        {/* Left: Map */}
        <div className="w-1/2 relative border-r border-zinc-800">
          <MapContainer 
            center={[46.4825, 30.7233]} 
            zoom={12} 
            className="w-full h-full"
            style={{ background: '#09090b' }}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              className="grayscale-[0.8] invert-[0.9] opacity-60"
            />
            <SelectionTool onSelectionChange={setSelectionBounds} />
            {selectionBounds && (
              <Rectangle bounds={selectionBounds} pathOptions={{ color: '#3b82f6', weight: 2, fillOpacity: 0.1 }} />
            )}
          </MapContainer>

          <div className="absolute bottom-6 left-6 bg-zinc-900/95 border border-zinc-800 p-4 rounded-2xl shadow-2xl backdrop-blur-md max-w-xs z-[1000]">
            <div className="flex items-center gap-2 mb-2">
              <MousePointer2 className="w-4 h-4 text-blue-400" />
              <span className="text-xs font-bold uppercase tracking-wider">Управление</span>
            </div>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Зажмите <kbd className="px-1.5 py-0.5 bg-zinc-800 rounded text-zinc-200 border border-zinc-700">Shift</kbd> и тяните мышкой по карте, чтобы выделить область.
            </p>
          </div>

          {error && (
            <div className="absolute inset-0 flex items-center justify-center bg-zinc-900/90 backdrop-blur-md p-8 text-center z-[1001]">
              <div className="max-w-md">
                <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
                <h3 className="text-lg font-bold mb-2">Ошибка</h3>
                <p className="text-zinc-400 text-sm">{error}</p>
                <button 
                  onClick={() => setError(null)}
                  className="mt-6 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-xs transition-colors"
                >
                  Закрыть
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Right: 3D Preview */}
        <div className="w-1/2 relative bg-zinc-950">
          <div ref={previewRef} className="w-full h-full" />
          
          {!elevationData && !isLoading && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center opacity-20">
                <Box className="w-24 h-24 mx-auto mb-4" />
                <p className="text-sm font-medium">Выделите область (Shift + Drag)</p>
              </div>
            </div>
          )}

          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/50 backdrop-blur-sm">
              <div className="flex flex-col items-center gap-4">
                <div className="relative">
                  <div className="w-12 h-12 border-4 border-blue-500/20 rounded-full" />
                  <div className="absolute inset-0 w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
                </div>
                <p className="text-xs font-mono text-blue-400 uppercase tracking-widest">Fetching Elevation Data</p>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Footer / Status Bar */}
      <footer className="h-10 border-t border-zinc-800 bg-zinc-900 flex items-center px-6 justify-between z-50">
        <div className="flex items-center gap-4 text-[10px] font-mono text-zinc-500">
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            OPEN-ELEVATION: READY
          </div>
          <div className="w-px h-3 bg-zinc-800" />
          <div>GRID: {gridSize.width}x{gridSize.height}</div>
          <div className="w-px h-3 bg-zinc-800" />
          <div>POINTS: {(gridSize.width * gridSize.height).toLocaleString()}</div>
        </div>
        <div className="text-[10px] font-mono text-zinc-600">
          FREE VERSION &bull; NO API KEY REQUIRED
        </div>
      </footer>
    </div>
  );
}
