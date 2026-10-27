import React, { useEffect, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

const OUR_TEAM_COLOR = '#00E5FF';

const DOT_CONFIGS = [
  { id: 'rocket', symbol: '🚀', lngLat: [-74.006, 40.7128] }, // NYC Hall
  { id: 'fire', symbol: '🔥', lngLat: [-73.985, 40.7484] },   // Midtown
  { id: 'alien', symbol: '👾', lngLat: [-74.015, 40.7050] }    // Battery Park
];

const OSM_STYLE = {
  version: 8,
  sources: {
    'osm-tiles': {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }
  },
  layers: [
    {
      id: 'osm-tiles-layer',
      type: 'raster',
      source: 'osm-tiles',
      minzoom: 0,
      maxzoom: 19
    }
  ]
};

export default function App() {
  const mapContainer = useRef(null);
  const mapInstance = useRef(null);
  const markersRef = useRef([]);

  useEffect(() => {
    if (mapInstance.current) return;

    // Strict 2D Map setup
    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: OSM_STYLE,
      center: [-74.006, 40.7128],
      zoom: 13,
      pitch: 0,
      maxPitch: 0,
      bearing: 0,
      touchPitch: false,
      pitchWithRotate: false,
      dragRotate: false
    });

    mapInstance.current = map;

    map.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      'top-right'
    );

    // Create Zero-Drift Markers
    DOT_CONFIGS.forEach((cfg) => {
      // 1. OUTER WRAPPER: Handles MapLibre coordinate positioning only
      // Having fixed dimensions and flex-center guarantees the anchor point never moves
      const outerEl = document.createElement('div');
      outerEl.style.width = '48px';
      outerEl.style.height = '48px';
      outerEl.style.display = 'flex';
      outerEl.style.alignItems = 'center';
      outerEl.style.justifyContent = 'center';
      outerEl.style.cursor = 'pointer';

      // 2. INNER ELEMENT: Handles emoji rendering, glow, and selection scaling
      // Isolating transform: scale here prevents any anchor drift during zooming
      const innerEl = document.createElement('div');
      innerEl.innerText = cfg.symbol;
      innerEl.style.fontSize = '40px';
      innerEl.style.lineHeight = '1';
      innerEl.style.userSelect = 'none';
      innerEl.style.webkitUserSelect = 'none';
      innerEl.style.transition = 'filter 0.2s ease, transform 0.15s ease';
      innerEl.style.transform = 'scale(1)';
      innerEl.style.filter = `drop-shadow(0 0 4px ${OUR_TEAM_COLOR})`;

      outerEl.appendChild(innerEl);

      let isSelected = false;

      const updateSelection = () => {
        if (isSelected) {
          innerEl.style.transform = 'scale(1.35)';
          innerEl.style.filter = `drop-shadow(0 0 14px ${OUR_TEAM_COLOR}) drop-shadow(0 0 6px ${OUR_TEAM_COLOR})`;
        } else {
          innerEl.style.transform = 'scale(1)';
          innerEl.style.filter = `drop-shadow(0 0 4px ${OUR_TEAM_COLOR})`;
        }
      };

      // Tap / Click handling
      outerEl.addEventListener('click', (e) => {
        e.stopPropagation();
        isSelected = !isSelected;
        updateSelection();
      });

      const marker = new maplibregl.Marker({
        element: outerEl,
        anchor: 'center' // Explicit center anchor
      })
        .setLngLat(cfg.lngLat)
        .addTo(map);

      markersRef.current.push(marker);
    });

    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      map.remove();
      mapInstance.current = null;
    };
  }, []);

  return (
    <div
      ref={mapContainer}
      style={{
        width: '100vw',
        height: '100vh',
        position: 'absolute',
        top: 0,
        left: 0,
        touchAction: 'none',
        overflow: 'hidden'
      }}
    />
  );
}