// A small PowerPoint, written here rather than checked in, so a test can say
// what is in it. Three slides, in an order that is not their file names':
//
//   1 (slide1.xml)  a title placeholder with a bold word, a bulleted body
//                   placeholder at two levels, a picture, a table, a chart,
//                   a sound, and speaker notes
//   2 (slide3.xml)  an equation, which only its fallback picture can draw
//   3 (slide2.xml)  hidden; a text box with a link, a group, a freeform and
//                   an arrow
//
// The master draws a band across every slide and a title style the title
// slide inherits; the layout moves the body placeholder.

import zlib from 'node:zlib';

const NS =
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

// 1x1 PNG.
export const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** A PNG signature with enough after it to be worth a blob. */
export const BIG_PNG = Buffer.concat([PNG.subarray(0, 16), Buffer.alloc(40 * 1024, 7)]);

const rels = (list) =>
  `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list
    .map(([id, type, target, external]) => `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"${external ? ' TargetMode="External"' : ''}/>`)
    .join('')}</Relationships>`;

const xfrm = (x, y, w, h, extra = '') => `<a:xfrm${extra}><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm>`;

const theme = `<?xml version="1.0" encoding="UTF-8"?><a:theme ${NS} name="Office"><a:themeElements>
<a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
<a:dk2><a:srgbClr val="1F497D"/></a:dk2><a:lt2><a:srgbClr val="EEECE1"/></a:lt2><a:accent1><a:srgbClr val="4F81BD"/></a:accent1>
<a:accent2><a:srgbClr val="C0504D"/></a:accent2><a:accent3><a:srgbClr val="9BBB59"/></a:accent3><a:accent4><a:srgbClr val="8064A2"/></a:accent4>
<a:accent5><a:srgbClr val="4BACC6"/></a:accent5><a:accent6><a:srgbClr val="F79646"/></a:accent6><a:hlink><a:srgbClr val="0000FF"/></a:hlink><a:folHlink><a:srgbClr val="800080"/></a:folHlink></a:clrScheme>
<a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri Light"/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/></a:minorFont></a:fontScheme>
<a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>
<a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="25400"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="38100"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>
<a:effectStyleLst/><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;

const master = `<?xml version="1.0" encoding="UTF-8"?><p:sldMaster ${NS}><p:cSld>
<p:bg><p:bgPr><a:solidFill><a:srgbClr val="FAFAF5"/></a:solidFill></p:bgPr></p:bg>
<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr>${xfrm(457200, 274638, 8229600, 1143000)}</p:spPr><p:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/><a:p><a:r><a:t>Master title</a:t></a:r></a:p></p:txBody></p:sp>
<p:sp><p:nvSpPr><p:cNvPr id="3" name="Body"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr>${xfrm(457200, 1600200, 8229600, 3000000)}</p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Master body</a:t></a:r></a:p></p:txBody></p:sp>
<p:sp><p:nvSpPr><p:cNvPr id="4" name="Band"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(0, 4943475, 9144000, 200025)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></p:spPr></p:sp>
</p:spTree></p:cSld>
<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>
<p:txStyles>
<p:titleStyle><a:lvl1pPr algn="l"><a:defRPr sz="4400"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mj-lt"/></a:defRPr></a:lvl1pPr></p:titleStyle>
<p:bodyStyle><a:lvl1pPr marL="228600" indent="-228600"><a:buFont typeface="Arial"/><a:buChar char="•"/><a:defRPr sz="2800"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl1pPr>
<a:lvl2pPr marL="685800" indent="-228600"><a:buFont typeface="Arial"/><a:buChar char="–"/><a:defRPr sz="2400"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:defRPr></a:lvl2pPr></p:bodyStyle>
<p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle>
</p:txStyles></p:sldMaster>`;

const layout = `<?xml version="1.0" encoding="UTF-8"?><p:sldLayout ${NS} type="obj"><p:cSld name="Title and Content"><p:spTree>
<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Click to add title</a:t></a:r></a:p></p:txBody></p:sp>
<p:sp><p:nvSpPr><p:cNvPr id="3" name="Content"/><p:cNvSpPr/><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:spPr>${xfrm(914400, 1371600, 7315200, 3200400)}</p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Click to add text</a:t></a:r></a:p></p:txBody></p:sp>
</p:spTree></p:cSld></p:sldLayout>`;

const tree = (body) =>
  `<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${body}</p:spTree></p:cSld>`;

const slide1 = `<?xml version="1.0" encoding="UTF-8"?><p:sld ${NS} xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main">${tree(`
<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>Hello </a:t></a:r><a:r><a:rPr lang="en-US" b="1"/><a:t>world</a:t></a:r></a:p></p:txBody></p:sp>
<p:sp><p:nvSpPr><p:cNvPr id="3" name="Content 2"/><p:cNvSpPr/><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr><a:normAutofit fontScale="50000"/></a:bodyPr><a:lstStyle/>
<a:p><a:r><a:t>First point</a:t></a:r></a:p><a:p><a:pPr lvl="1"/><a:r><a:t>A smaller one</a:t></a:r></a:p><a:p><a:pPr marL="0" indent="0"><a:buNone/></a:pPr><a:r><a:t>No bullet &amp; plain</a:t></a:r></a:p></p:txBody></p:sp>
<p:pic><p:nvPicPr><p:cNvPr id="4" name="Picture 3" descr="A red square"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"/><a:srcRect l="10000" r="10000"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm(6400800, 3200400, 1828800, 1371600)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>
<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="5" name="Table 4"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="457200" y="3657600"/><a:ext cx="3657600" cy="740664"/></p:xfrm>
<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1" bandRow="1"/><a:tblGrid><a:gridCol w="1828800"/><a:gridCol w="1828800"/></a:tblGrid>
<a:tr h="370332"><a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Year</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc><a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Rate</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc></a:tr>
<a:tr h="370332"><a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>2026</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc><a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>4.5%</a:t></a:r></a:p></a:txBody><a:tcPr><a:solidFill><a:srgbClr val="FFEE00"/></a:solidFill></a:tcPr></a:tc></a:tr>
</a:tbl></a:graphicData></a:graphic></p:graphicFrame>
<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="6" name="Chart 5"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="4572000" y="3657600"/><a:ext cx="1828800" cy="740664"/></p:xfrm>
<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rId9"/></a:graphicData></a:graphic></p:graphicFrame>
<p:pic><p:nvPicPr><p:cNvPr id="7" name="Sound"/><p:cNvPicPr/><p:nvPr><a:audioFile r:link="rId5"/><p:extLst><p:ext uri="{DAA4B4D4-6D71-4841-9C94-3DE7FCFB9230}"><p14:media r:embed="rId4"/></p:ext></p:extLst></p:nvPr></p:nvPicPr><p:blipFill><a:blip r:embed="rId6"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm(8458200, 4343400, 304800, 304800)}</p:spPr></p:pic>
`)}</p:sld>`;

const slide2 = `<?xml version="1.0" encoding="UTF-8"?><p:sld ${NS} show="0">${tree(`
<p:sp><p:nvSpPr><p:cNvPr id="2" name="TextBox 1"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(457200, 457200, 4572000, 457200)}<a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="square"/><a:lstStyle/>
<a:p><a:pPr algn="ctr"/><a:r><a:rPr sz="2000"><a:solidFill><a:srgbClr val="C00000"/></a:solidFill></a:rPr><a:t>Read </a:t></a:r><a:r><a:rPr sz="2000"><a:hlinkClick r:id="rId2"/></a:rPr><a:t>the source</a:t></a:r></a:p></p:txBody></p:sp>
<p:grpSp><p:nvGrpSpPr><p:cNvPr id="3" name="Group 2"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr>${xfrm(914400, 1828800, 1828800, 914400).replace('</a:xfrm>', '<a:chOff x="0" y="0"/><a:chExt cx="3657600" cy="1828800"/></a:xfrm>')}</p:grpSpPr>
<p:sp><p:nvSpPr><p:cNvPr id="4" name="Oval 3"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(1828800, 914400, 1828800, 914400)}<a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom></p:spPr>
<p:style><a:lnRef idx="2"><a:schemeClr val="accent1"><a:shade val="50000"/></a:schemeClr></a:lnRef><a:fillRef idx="1"><a:schemeClr val="accent2"/></a:fillRef><a:effectRef idx="0"><a:schemeClr val="accent1"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></p:style>
<p:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:t>In a group</a:t></a:r></a:p></p:txBody></p:sp></p:grpSp>
<p:sp><p:nvSpPr><p:cNvPr id="5" name="Freeform 4"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(5486400, 1828800, 914400, 914400)}<a:custGeom><a:avLst/><a:gdLst/><a:pathLst><a:path w="100" h="100"><a:moveTo><a:pt x="0" y="100"/></a:moveTo><a:lnTo><a:pt x="50" y="0"/></a:lnTo><a:lnTo><a:pt x="100" y="100"/></a:lnTo><a:close/></a:path></a:pathLst></a:custGeom><a:solidFill><a:srgbClr val="00AA55"/></a:solidFill></p:spPr></p:sp>
<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="6" name="Arrow 5"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr>${xfrm(457200, 4114800, 2743200, 0)}<a:prstGeom prst="straightConnector1"><a:avLst/></a:prstGeom><a:ln w="19050"><a:solidFill><a:srgbClr val="333333"/></a:solidFill><a:tailEnd type="triangle"/></a:ln></p:spPr></p:cxnSp>
`)}</p:sld>`;

const slide3 = `<?xml version="1.0" encoding="UTF-8"?><p:sld ${NS} xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main">${tree(`
<mc:AlternateContent><mc:Choice Requires="a14"><p:sp><p:nvSpPr><p:cNvPr id="2" name="Equation"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(457200, 457200, 2743200, 457200)}</p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a14:m><m:oMathPara xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"/></a14:m></a:p></p:txBody></p:sp></mc:Choice>
<mc:Fallback><p:sp><p:nvSpPr><p:cNvPr id="2" name="Equation"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(457200, 457200, 2743200, 457200)}<a:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></a:blipFill></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t> </a:t></a:r></a:p></p:txBody></p:sp></mc:Fallback></mc:AlternateContent>
`)}</p:sld>`;

const notes1 = `<?xml version="1.0" encoding="UTF-8"?><p:notes ${NS}>${tree(`
<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image"/><p:cNvSpPr/><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp>
<p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Say hello.</a:t></a:r></a:p><a:p><a:r><a:t>Then the rest &lt;slowly&gt;.</a:t></a:r></a:p></p:txBody></p:sp>
`)}</p:notes>`;

/** The parts of the package, by name. */
export function pptxParts({ width = 9144000, height = 5143500, picture = PNG } = {}) {
  return {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    '_rels/.rels': rels([['rId1', 'officeDocument', 'ppt/presentation.xml']]),
    'ppt/presentation.xml': `<?xml version="1.0" encoding="UTF-8"?><p:presentation ${NS}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
<p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId4"/><p:sldId id="258" r:id="rId3"/></p:sldIdLst><p:sldSz cx="${width}" cy="${height}"/><p:notesSz cx="6858000" cy="9144000"/>
<p:defaultTextStyle><a:defPPr><a:defRPr lang="en-US"/></a:defPPr><a:lvl1pPr><a:defRPr sz="1800"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl1pPr></p:defaultTextStyle></p:presentation>`,
    'ppt/_rels/presentation.xml.rels': rels([
      ['rId1', 'slideMaster', 'slideMasters/slideMaster1.xml'],
      ['rId2', 'slide', 'slides/slide1.xml'],
      ['rId3', 'slide', 'slides/slide2.xml'],
      ['rId4', 'slide', 'slides/slide3.xml'],
    ]),
    'ppt/slideMasters/slideMaster1.xml': master,
    'ppt/slideMasters/_rels/slideMaster1.xml.rels': rels([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'], ['rId2', 'theme', '../theme/theme1.xml']]),
    'ppt/slideLayouts/slideLayout1.xml': layout,
    'ppt/slideLayouts/_rels/slideLayout1.xml.rels': rels([['rId1', 'slideMaster', '../slideMasters/slideMaster1.xml']]),
    'ppt/theme/theme1.xml': theme,
    'ppt/slides/slide1.xml': slide1,
    'ppt/slides/_rels/slide1.xml.rels': rels([
      ['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'],
      ['rId2', 'image', '../media/image1.png'],
      ['rId3', 'notesSlide', '../notesSlides/notesSlide1.xml'],
      ['rId4', 'media', '../media/media1.mp3'],
      ['rId5', 'audio', '../media/media1.mp3'],
      ['rId6', 'image', '../media/image2.png'],
      ['rId9', 'chart', '../charts/chart1.xml'],
    ]),
    'ppt/slides/slide2.xml': slide2,
    'ppt/slides/_rels/slide2.xml.rels': rels([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'], ['rId2', 'hyperlink', 'https://example.com/source', true]]),
    'ppt/slides/slide3.xml': slide3,
    'ppt/slides/_rels/slide3.xml.rels': rels([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'], ['rId2', 'image', '../media/image3.png']]),
    'ppt/notesSlides/notesSlide1.xml': notes1,
    'ppt/media/image1.png': picture,
    'ppt/media/image2.png': PNG,
    'ppt/media/image3.png': PNG,
    'ppt/media/media1.mp3': Buffer.from('ID3 not really a song'),
  };
}

/** A zip of `parts`: XML deflated, pictures stored, the way Office does it. */
export function zipOf(parts) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of Object.entries(parts)) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const stored = /\.(png|jpe?g|mp3)$/.test(name);
    const packed = stored ? data : zlib.deflateRawSync(data);
    const nameBytes = Buffer.from(name, 'utf8');
    const crc = zlib.crc32(data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(0x800, 6);
    head.writeUInt16LE(stored ? 0 : 8, 8);
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(packed.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(nameBytes.length, 26);
    locals.push(head, nameBytes, packed);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x800, 8);
    entry.writeUInt16LE(stored ? 0 : 8, 10);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(packed.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBytes);
    offset += 30 + nameBytes.length + packed.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(central.length / 2, 8);
  end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

export const makePptx = (options) => zipOf(pptxParts(options));
