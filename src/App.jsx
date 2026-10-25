import React, { useEffect, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

const OUR_TEAM_COLOR = '#00E5FF';

const DOT_CONFIGS = [
  { id: 'rocket', symbol: '🚀', lngLat: [-74.006, 40.7128] }, // NYC Hall
  { id: 'fire', symbol: '🔥', lngLat: [-73.985, 40.7484] },   // Midtown
  { id: 'alien', symbol: '👾', lngLat: [-74.015, 40.7050] }    // Battery Park
];

/**
 * Registers emojis as WebGL textures.
 * Uses ctx.getImageData to pass raw pixel data directly to WebGL.
 */
function registerEmojiImages(map) {
  const size = 128;

  DOT_CONFIGS.forEach((cfg) => {
    [false, true].forEach((isSelected) => {
      const imgName = `unit-icon-${cfg.id}-${isSelected ? 'selected' : 'normal'}`;
      if (map.hasImage(imgName)) return;

      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });

      ctx.clearRect(0, 0, size, size);

      // Team glow shadow
      if (isSelected) {
        ctx.filter = `drop-shadow(0 0 12px ${OUR_TEAM_COLOR}) drop-shadow(0 0 6px ${OUR_TEAM_COLOR})`;
        ctx.shadowColor = OUR_TEAM_COLOR;
        ctx.shadowBlur = 16;
      } else {
        ctx.filter = `drop-shadow(0 0 4px ${OUR_TEAM_COLOR})`;
        ctx.shadowColor = OUR_TEAM_COLOR;
        ctx.shadowBlur = 6;
      }

      // Font stack ensuring native full-color emojis on iOS, Android, and Windows
      ctx.font = '62px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // Draw the emoji in the center
      ctx.fillText(cfg.symbol, size / 2, size / 2);

      // FIX: WebGL requires raw ImageData pixels ({ width, height, data })
      const imageData = ctx.getImageData(0, 0, size, size);
      map.addImage(imgName, imageData, { pixelRatio: 2 });
    });
  });
}

export default function App() {
  const mapContainer = useRef(null);
  const mapInstance = useRef(null);

  useEffect(() => {
    if (mapInstance.current) return;

    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: 'https://demotiles.maplibre.org/style.json',
      center: [-74.006, 40.7128],
      zoom: 12,
      pitch: 45,
      touchPitch: true,
      touchZoomRotate: true
    });

    mapInstance.current = map;

    // Feature collection for our emojis
    const geojsonData = {
      type: 'FeatureCollection',
      features: DOT_CONFIGS.map((cfg, index) => ({
        type: 'Feature',
        id: index,
        properties: {
          id: cfg.id,
          selected: false
        },
        geometry: {
          type: 'Point',
          coordinates: cfg.lngLat
        }
      }))
    };

    const setupLayers = () => {
      // 1. Register icons synchronously
      registerEmojiImages(map);

      // 2. Add GeoJSON Source
      map.addSource('emoji-units', {
        type: 'geojson',
        data: geojsonData
      });

      // 3. Add WebGL Symbol Layer
      map.addLayer({
        id: 'emoji-layer',
        type: 'symbol',
        source: 'emoji-units',
        layout: {
          'icon-image': [
            'concat',
            'unit-icon-',
            ['get', 'id'],
            '-',
            ['case', ['get', 'selected'], 'selected', 'normal']
          ],
          'icon-size': 1,
          'icon-allow-overlap': true,
          'icon-ignore-placement': true
        },
        paint: {
          'icon-opacity': 1
        }
      });

      // 4. Mobile tap & Desktop click handler to toggle glow
      map.on('click', 'emoji-layer', (e) => {
        if (!e.features?.length) return;
        const featureId = e.features[0].id;
        const target = geojsonData.features.find((f) => f.id === featureId);

        if (target) {
          target.properties.selected = !target.properties.selected;
          map.getSource('emoji-units').setData(geojsonData);
        }
      });

      // Cursor hover states for desktop
      map.on('mouseenter', 'emoji-layer', () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', 'emoji-layer', () => {
        map.getCanvas().style.cursor = '';
      });
    };

    if (map.loaded()) {
      setupLayers();
    } else {
      map.on('load', setupLayers);
    }

    return () => {
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