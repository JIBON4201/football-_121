import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'omincalc',
    short_name: 'omincalc',
    description: 'omincalc — football news, fixtures, results, teams, players and competitions.',
    start_url: '/',
    display: 'standalone',
    background_color: '#0d1f14',
    theme_color: '#0d1f14',
    icons: [
      { src: '/logo.png', sizes: 'any', type: 'image/png' },
      { src: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  };
}
