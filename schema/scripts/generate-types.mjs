/**
 * Generate TypeScript interfaces from the AsyncAPI spec using Modelina.
 *
 * Usage: node scripts/generate-types.mjs
 */
import { TypeScriptGenerator } from '@asyncapi/modelina';
import { readFileSync, mkdirSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SPEC_PATH = resolve(ROOT, 'poker-protocol.asyncapi.yaml');
const OUTPUT_DIR = resolve(ROOT, 'generated/types');

async function main() {
  console.log(`Reading spec from ${SPEC_PATH}`);

  const generator = new TypeScriptGenerator({
    modelType: 'interface',
    enumType: 'enum',
  });

  const specContent = readFileSync(SPEC_PATH, 'utf-8');
  const models = await generator.generateCompleteModels(specContent, {});

  mkdirSync(OUTPUT_DIR, { recursive: true });

  const allContent = [];
  for (const model of models) {
    allContent.push(`// --- ${model.modelName} ---`);
    allContent.push(model.result);
    allContent.push('');
  }

  const outputPath = resolve(OUTPUT_DIR, 'protocol.ts');
  writeFileSync(outputPath, allContent.join('\n'), 'utf-8');
  console.log(`Generated ${models.length} models -> ${outputPath}`);
}

main().catch((err) => {
  console.error('Type generation failed:', err);
  process.exit(1);
});
