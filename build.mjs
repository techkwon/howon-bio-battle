// site/src → site/dist 묶기 (Firebase SDK 를 사이트에 같이 싣는다 — 학교망 CDN 차단 대비)
import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');
const opts = {
  entryPoints: { host: 'site/src/core-host.js', play: 'site/src/core-play.js' },
  bundle: true,
  outdir: 'site/dist',
  format: 'iife',
  target: ['chrome100', 'edge100', 'safari15'],
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  legalComments: 'none',
  logLevel: 'info',
};
if (watch) { const ctx = await esbuild.context(opts); await ctx.watch(); }
else await esbuild.build(opts);
