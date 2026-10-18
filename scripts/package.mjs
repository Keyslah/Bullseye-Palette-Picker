/**
 * Purpose: produce a load-unpacked Chrome extension ZIP from the reviewed extension folder.
 * Setup: run npm run package; requires Python 3 for standard-library ZIP support.
 * Destructive behavior: replaces only dist/Bullseye-Palette-Picker-v<version>.zip.
 * Constraints: excludes developer caches, tests, source downloads, and personal data.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'extension/manifest.json'), 'utf8'));
const output = path.join(root, 'dist', `Bullseye-Palette-Picker-v${manifest.version}.zip`);
fs.mkdirSync(path.dirname(output), {recursive: true});
const program = `import pathlib,sys,zipfile
root=pathlib.Path(sys.argv[1]); output=pathlib.Path(sys.argv[2])
with zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as archive:
    for file in sorted((root/'extension').rglob('*')):
        if file.is_file(): archive.write(file,str(file.relative_to(root/'extension')))
    for name in ['README.md','ATTRIBUTION.md','PRIVACY.md','LICENSE']:
        if (root/name).exists(): archive.write(root/name,name)
with zipfile.ZipFile(output) as archive:
    assert archive.testzip() is None
    assert 'manifest.json' in archive.namelist()
print(str(output))
`;
let result;
for (const python of [process.env.PYTHON, 'python3', 'python'].filter(Boolean)) {
  try { result = execFileSync(python, ['-c', program, root, output], {encoding: 'utf8'}); break; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
if (!result) throw new Error('Python 3 is required for packaging. The extension folder can also be loaded directly in Chrome.');
process.stdout.write(result);
