// Run with Node supporting node:sqlite. Only SELECT; no application import or credentials.
import { DatabaseSync } from "node:sqlite";
import { writeFile } from "node:fs/promises";
import path from "node:path";
const [databasePath, outputPath]=process.argv.slice(2);
if(!databasePath||!outputPath)throw new Error("explicit read-only database and isolated output required");
const db=new DatabaseSync(path.resolve(databasePath),{readOnly:true});
try {
  const query=db.prepare("SELECT path, size_bytes, duration_ms, video_codec, audio_codec FROM videos WHERE provider_file_id IS NOT NULL AND is_missing=0 AND size_bytes>1000000 AND duration_ms>10000 AND video_codec=? AND audio_codec=? ORDER BY size_bytes ASC LIMIT 1");
  const samples=[];
  for(const [v,a] of [["hevc","aac"],["mpeg4","mp3"],["h264","pcm_s16le"]]) {
    const row=query.get(v,a);if(row)samples.push({name:`cloud-${v}-${a}`,path:row.path,sizeBytes:row.size_bytes,durationMs:row.duration_ms});
  }
  if(!samples.length)throw new Error("no-cached-codec-samples");
  await writeFile(path.resolve(outputPath),JSON.stringify(samples,null,2));
  console.log(JSON.stringify(samples.map(({name,sizeBytes,durationMs})=>({name,sizeBytes,durationMs}))));
} finally {db.close();}
