import { PNG } from 'pngjs'; import fs from 'node:fs';
const load = f => PNG.sync.read(fs.readFileSync(f));
for (const v of ['spine','board','framings','map']) {
  const a=load(`p-${v}.png`), b=load(`b-${v}.png`);
  if (a.width!==b.width||a.height!==b.height){ console.log(v,'size',a.width+'x'+a.height,'vs',b.width+'x'+b.height); continue; }
  let n=0,minY=1e9,maxY=-1,minX=1e9,maxX=-1;
  for(let y=0;y<a.height;y++)for(let x=0;x<a.width;x++){const i=(y*a.width+x)*4;
    if(Math.abs(a.data[i]-b.data[i])>3||Math.abs(a.data[i+1]-b.data[i+1])>3||Math.abs(a.data[i+2]-b.data[i+2])>3){n++;if(y<minY)minY=y;if(y>maxY)maxY=y;if(x<minX)minX=x;if(x>maxX)maxX=x;}}
  console.log(v, 'diffpx', n, n?`box x${minX}-${maxX} y${minY}-${maxY}`:'');
}
