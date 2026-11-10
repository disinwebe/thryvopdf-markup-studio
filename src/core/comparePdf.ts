import { bakePageObjects, type PageObject } from './pageContent';
import { saveWithState, type DocState } from './annotations';

export async function prepareComparisonPdf(bytes: Uint8Array, pageObjects: PageObject[], state: DocState): Promise<Uint8Array> {
  const withPageObjects = await bakePageObjects(bytes, pageObjects);
  return saveWithState(withPageObjects, state);
}
