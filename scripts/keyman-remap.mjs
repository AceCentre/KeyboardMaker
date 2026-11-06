/**
 * keyman-remap.mjs
 *
 * JavaScript port of the original Streamlit/Python Keyman flow:
 * take the bundled Grid 3 template (template.gridset), remap its grids with
 * the key mappings from a Keyman .kvks keyboard file, optionally set the
 * gridset language, and return the rebuilt .gridset bytes.
 *
 * Used by the static site (docs/) — everything runs in the browser via
 * JSZip + fast-xml-parser.
 */

import JSZip from 'jszip';
import { XMLParser, XMLBuilder } from 'fast-xml-parser';

// Grid folder -> KVKS layer shift-state code (mirrors the Python original)
const FOLDER_TO_LAYER = {
  default: '',
  shift: 'S',
  ctrl: 'C',
  shift_ctrl: 'SC',
  alt: 'RA',
  shift_alt: 'SRA',
  ctrl_alt: 'CRA',
  shift_ctrl_alt: 'SCA',
};

// Valid Grid language settings (mirrors GRID_SUPPORTED_LANGUAGES in the
// original app; keys are gridset <Language> codes, values [short, name])
export const GRID_SUPPORTED_LANGUAGES = {
  'af-ZA': ['af', 'Afrikaans'],
  'ar-SA': ['ar', 'Arabic'],
  'ca-ES': ['ca', 'Catalan'],
  'cs-CZ': ['cs', 'Czech'],
  'cy-GB': ['cy', 'Welsh'],
  'da-DK': ['da', 'Danish'],
  'de-AT': ['de', 'German (Austria)'],
  'de-DE': ['de', 'German'],
  'el-GR': ['el', 'Greek'],
  'en-AU': ['en', 'English (Australia)'],
  'en-CA': ['en', 'English (Canada)'],
  'en-GB': ['en', 'English (UK)'],
  'en-NZ': ['en', 'English (New Zealand)'],
  'en-US': ['en', 'English (US)'],
  'en-ZA': ['en', 'English (South Africa)'],
  'es-ES': ['es', 'Spanish'],
  'es-US': ['es', 'Spanish (US)'],
  'eu-ES': ['eu', 'Basque'],
  'fi-FI': ['fi', 'Finnish'],
  'fo-FO': ['fo', 'Faroese'],
  'fr-CA': ['fr', 'French (Canada)'],
  'fr-FR': ['fr', 'French'],
  'he-IL': ['he', 'Hebrew'],
  'hr-HR': ['hr', 'Croatian'],
  'it-IT': ['it', 'Italian'],
  'nb-NO': ['nb', 'Norwegian'],
  'nl-BE': ['nl', 'Dutch (Belgium)'],
  'nl-NL': ['nl', 'Dutch'],
  'pl-PL': ['pl', 'Polish'],
  'pt-BR': ['pt', 'Portuguese (Brazil)'],
  'pt-PT': ['pt', 'Portuguese'],
  'ru-RU': ['ru', 'Russian'],
  'sk-SK': ['sk', 'Slovak'],
  'sl-SI': ['sl', 'Slovenian'],
  'sv-SE': ['sv', 'Swedish'],
  'uk-UA': ['uk', 'Ukrainian'],
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  cdataPropName: '__cdata',
});

const builder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  format: true,
  indentBy: '  ',
  suppressEmptyNode: true,
  cdataPropName: '__cdata',
});

/**
 * Parse KVKS XML text into { layerCode: { vkey: char } }.
 * Mirrors parse_kvks_content() from the Python app.
 */
export function parseKvksContent(kvksXmlText) {
  const doc = parser.parse(kvksXmlText);
  const layers = {};

  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node.layer !== undefined) {
      const layerNodes = Array.isArray(node.layer) ? node.layer : [node.layer];
      for (const layer of layerNodes) {
        const shiftState = layer['@_shift'] ?? '';
        const mappings = {};
        const keys = layer.key === undefined ? [] : Array.isArray(layer.key) ? layer.key : [layer.key];
        for (const key of keys) {
          mappings[key['@_vkey']] = key['#text'] ?? key.__cdata ?? '';
        }
        layers[shiftState] = mappings;
      }
    }
    for (const value of Object.values(node)) walk(value);
  }
  walk(doc);
  return layers;
}

/** Get a node's text content regardless of fast-xml-parser's node shapes. */
function getText(node) {
  if (node === undefined || node === null) return undefined;
  if (typeof node === 'string') return node;
  if (typeof node === 'object') {
    if (node.__cdata !== undefined) return node.__cdata;
    if (node['#text'] !== undefined) return node['#text'];
  }
  return undefined;
}

/** Set a node's text content in place, preserving its original shape. */
function setText(node, value) {
  if (typeof node === 'string') return value;
  if (node && typeof node === 'object') {
    if (node.__cdata !== undefined) node.__cdata = value;
    else node['#text'] = value;
    return node;
  }
  return value;
}

function asArray(node) {
  if (node === undefined || node === null) return [];
  return Array.isArray(node) ? node : [node];
}

/**
 * Remap one grid.xml string with a layer's key mappings.
 * Mirrors modify_grid_xml_with_layer() from the Python app.
 */
export function remapGridXml(gridXml, keyMappings, placeholder = '*') {
  const doc = parser.parse(gridXml);
  const grid = doc.Grid;
  if (!grid || !grid.Cells) return gridXml;

  for (const cell of asArray(grid.Cells.Cell)) {
    const content = cell.Content;
    if (!content || !content.CaptionAndImage) continue;
    const captionNode = content.CaptionAndImage.Caption;
    const currentCaption = getText(captionNode);
    if (currentCaption === undefined) continue;

    const vkey = `K_${currentCaption.trim().toUpperCase()}`;
    if (!(vkey in keyMappings)) continue;

    const newCharacter = keyMappings[vkey] || placeholder;
    const updated = setText(captionNode, newCharacter);
    if (updated !== captionNode) content.CaptionAndImage.Caption = updated; // plain string replaced

    for (const command of asArray(content.Commands?.Command)) {
      for (const param of asArray(command.Parameter)) {
        if (param['@_Key'] === 'letter') {
          const updatedParam = setText(param, newCharacter);
          if (updatedParam !== param) {
            const params = Array.isArray(command.Parameter) ? command.Parameter : [command.Parameter];
            const idx = params.indexOf(param);
            params[idx] = updatedParam;
          }
        }
      }
    }
  }

  let xml = builder.build(doc);
  // The builder leaves blank lines around mutated nodes; collapse them.
  xml = xml.replace(/\n[ \t]*\n[ \t]*\n*/g, '\n');
  // Same post-processing hacks as the Python original: CDATA for the space
  // caption and the xsi namespace on the root <Grid>.
  xml = xml.replace(/<Caption>\s*<\/Caption>/g, '<Caption><![CDATA[ ]]></Caption>');
  xml = xml.replace('<Caption> </Caption>', '<Caption><![CDATA[ ]]></Caption>');
  if (!xml.includes('xmlns:xsi')) {
    xml = xml.replace('<Grid>', '<Grid xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">');
  }
  return xml;
}

/**
 * Add or update the <Language> tag in settings.xml content.
 * Mirrors add_language_to_gridset_settings() from the Python app.
 */
export function addLanguageToSettings(settingsXml, languageCode) {
  if (!(languageCode in GRID_SUPPORTED_LANGUAGES)) {
    throw new Error(`Invalid Grid language code: ${languageCode}`);
  }
  if (settingsXml.includes('<Language>')) {
    return settingsXml.replace(/<Language>[^<]*<\/Language>/, `<Language>${languageCode}</Language>`);
  }
  return settingsXml.replace(
    /<\/GridSetSettings>/,
    `  <Language>${languageCode}</Language>\n</GridSetSettings>`
  );
}

/**
 * Build a remapped gridset from the template bytes + KVKS XML text.
 * Mirrors modify_gridset_with_kvks_layers() + the zip/step of the Python app.
 *
 * @param {Uint8Array} templateBytes  contents of template.gridset
 * @param {string} kvksXmlText        raw .kvks XML from GitHub
 * @param {{ language?: string }} options  optional gridset language code
 * @returns {Promise<Uint8Array>}     rebuilt .gridset bytes
 */
export async function buildKeymanGridset(templateBytes, kvksXmlText, { language } = {}) {
  const layers = parseKvksContent(kvksXmlText);
  const zip = await JSZip.loadAsync(templateBytes);

  for (const [folder, layerCode] of Object.entries(FOLDER_TO_LAYER)) {
    const path = `Grids/${folder}/grid.xml`;
    const entry = zip.file(path);
    if (!entry) continue;
    const mappings = layers[layerCode] || {};
    const original = await entry.async('string');
    zip.file(path, remapGridXml(original, mappings));
  }

  if (language) {
    const settingsEntry = zip.file('Settings0/settings.xml');
    if (settingsEntry) {
      const settings = await settingsEntry.async('string');
      zip.file('Settings0/settings.xml', addLanguageToSettings(settings, language));
    }
  }

  return zip.generateAsync({ type: 'uint8array' });
}

/** Guess the best grid language code for a Keyman keyboard description. */
export function guessGridLanguage(keyboard) {
  const keyboardLang = String(
    keyboard.languageId ?? (typeof keyboard.language === 'string' ? keyboard.language : '') ?? ''
  )
    .split('-')[0]
    .toLowerCase();
  if (!keyboardLang) return null;

  const entries = Object.entries(GRID_SUPPORTED_LANGUAGES);
  for (const [code, [short]] of entries) {
    if (short.toLowerCase() === keyboardLang) {
      const region = String(keyboard.region ?? '').toLowerCase();
      if (region && `${keyboardLang}-${region}` === code.toLowerCase()) return code;
      // keep first base-language match; prefer exact region if it appears later
      const exact = entries.find(([c]) => c.toLowerCase() === `${keyboardLang}-${region}`);
      return exact ? exact[0] : code;
    }
  }
  if (['ar', 'fa', 'ur'].includes(keyboardLang)) return 'ar-SA';
  if (['zh', 'ja', 'ko'].includes(keyboardLang)) return 'en-US';
  return null;
}
