import streamlit as st
import streamlit.components.v1 as components
import requests
import os
import xml.etree.ElementTree as ET
import io
import zipfile
import shutil
import json
import tempfile
import subprocess
import glob

# Streamlit setup
st.title("Dynamic Keyboard Layout Maker for AAC")

# Enable or disable debugging
debugging = False

# Global variables
keyman_api_url = "https://api.keyman.com/search/2.0"

# Layout library settings
LAYOUTS_DIR = "layouts"
BROWSER_BUNDLE = os.path.join("static", "layout-generator.js")
GENERATOR_SCRIPT = os.path.join("scripts", "generate-gridset.mjs")
APP_DIR = os.path.dirname(os.path.abspath(__file__))

# Load the KVKS index JSON file
with open("kvks_index.json", "r") as f:
    kvks_index = json.load(f)

# Add this near the top of the file with other constants
GRID_SUPPORTED_LANGUAGES = {
    "af-ZA": ("af", "Afrikaans"),
    "ar-SA": ("ar", "Arabic"),
    "ca-ES": ("ca", "Catalan"),
    "cs-CZ": ("cs", "Czech"),
    "cy-GB": ("cy", "Welsh"),
    "da-DK": ("da", "Danish"),
    "de-AT": ("de", "German (Austria)"),
    "de-DE": ("de", "German"),
    "el-GR": ("el", "Greek"),
    "en-AU": ("en", "English (Australia)"),
    "en-CA": ("en", "English (Canada)"),
    "en-GB": ("en", "English (UK)"),
    "en-NZ": ("en", "English (New Zealand)"),
    "en-US": ("en", "English (US)"),
    "en-ZA": ("en", "English (South Africa)"),
    "es-ES": ("es", "Spanish"),
    "es-US": ("es", "Spanish (US)"),
    "eu-ES": ("eu", "Basque"),
    "fi-FI": ("fi", "Finnish"),
    "fo-FO": ("fo", "Faroese"),
    "fr-CA": ("fr", "French (Canada)"),
    "fr-FR": ("fr", "French"),
    "he-IL": ("he", "Hebrew"),
    "hr-HR": ("hr", "Croatian"),
    "it-IT": ("it", "Italian"),
    "nb-NO": ("nb", "Norwegian"),
    "nl-BE": ("nl", "Dutch (Belgium)"),
    "nl-NL": ("nl", "Dutch"),
    "pl-PL": ("pl", "Polish"),
    "pt-BR": ("pt", "Portuguese (Brazil)"),
    "pt-PT": ("pt", "Portuguese"),
    "ru-RU": ("ru", "Russian"),
    "sk-SK": ("sk", "Slovak"),
    "sl-SI": ("sl", "Slovenian"),
    "sv-SE": ("sv", "Swedish"),
    "uk-UA": ("uk", "Ukrainian")
}

# Function to unzip the template.gridset file into a temporary directory
def unzip_template_gridset():
    temp_dir = tempfile.mkdtemp(prefix="template_gridset_")
    if os.path.exists("template.gridset"):
        with zipfile.ZipFile("template.gridset", "r") as zip_ref:
            zip_ref.extractall(temp_dir)
        if debugging:
            st.write(f"Template gridset unzipped to: {temp_dir}")
    else:
        st.error("template.gridset file not found.")
    return temp_dir  # Return the temporary directory path


# Function to search Keyman keyboards and filter out those not in kvks_index
def search_keyboards(query):
    params = {
        "q": f"l:{query}",  # Search for language name
        "f": 1,  # Make it JSON readable
    }
    response = requests.get(keyman_api_url, params=params)
    keyboards_data = response.json()

    # Filter keyboards to only include those present in the kvks_index
    if "keyboards" in keyboards_data:
        filtered_keyboards = [
            keyboard
            for keyboard in keyboards_data["keyboards"]
            if keyboard["id"] in kvks_index
        ]
        return filtered_keyboards
    return []


# Function to fetch KVKS file directly from GitHub
def fetch_kvks_file(github_link):
    raw_url = github_link.replace("https://github.com/", "https://raw.githubusercontent.com/").replace("/blob/", "/")
    response = requests.get(raw_url)
    if response.status_code == 200:
        return response.content
    else:
        return None


# Function to parse KVKS content and extract layer mappings
def parse_kvks_content(kvks_content):
    tree = ET.ElementTree(ET.fromstring(kvks_content))
    root = tree.getroot()

    layers_mapping = {}
    for layer in root.findall(".//layer"):
        shift_state = layer.get("shift", "")
        key_mappings = {key.get("vkey"): key.text or "" for key in layer.findall(".//key")}
        layers_mapping[shift_state] = key_mappings

    return layers_mapping


# A hack: Add CDATA for space and namespace in the XML string
def add_cdata_for_space_and_namespace(xml_str):
    xml_str = xml_str.replace("<Caption> </Caption>", "<Caption><![CDATA[ ]]></Caption>")
    if "xmlns:xsi" not in xml_str:
        xml_str = xml_str.replace("<Grid>", '<Grid xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">')
    return xml_str


# Function to modify grid XML file with key mappings from the respective layer
def modify_grid_xml_with_layer(grid_xml_path, key_mappings, placeholder="*"):
    try:
        if debugging:
            st.write(f"Modifying grid: {grid_xml_path} with key mappings: {key_mappings}")

        tree = ET.parse(grid_xml_path)
        root = tree.getroot()
        replacements_count = 0

        for cell in root.findall(".//Cell"):
            caption_element = cell.find("Content/CaptionAndImage/Caption")
            command_elements = cell.findall(".//Commands/Command")

            if caption_element is not None:
                current_caption = caption_element.text.strip() if caption_element.text else ""
                vkey = f"K_{current_caption.upper()}"

                if vkey in key_mappings:
                    new_character = key_mappings[vkey] or placeholder
                    caption_element.text = new_character

                    for command in command_elements:
                        for param in command.findall("Parameter"):
                            if param.get("Key") == "letter":
                                param.text = new_character

                    replacements_count += 1

        xml_output = io.StringIO()
        tree.write(xml_output, encoding="unicode", xml_declaration=False)
        xml_str = xml_output.getvalue()
        updated_xml_str = add_cdata_for_space_and_namespace(xml_str)

        with open(grid_xml_path, "w", encoding="utf-8") as f:
            f.write(updated_xml_str)

        if debugging:
            st.write(f"Modified {replacements_count} keys in {grid_xml_path}")

    except ET.ParseError as e:
        st.error(f"XML Parsing Error: {e}")
    except Exception as e:
        st.error(f"An unexpected error occurred: {e}")


# Modify all layers of the gridset based on the layers in KVKS
def modify_gridset_with_kvks_layers(kvks_mappings, gridset_base_dir):
    folder_to_layer_mapping = {
        "default": "", "shift": "S", "ctrl": "C", "shift_ctrl": "SC", 
        "alt": "RA", "shift_alt": "SRA", "ctrl_alt": "CRA", "shift_ctrl_alt": "SCA"
    }

    for folder, layer in folder_to_layer_mapping.items():
        grid_xml_path = os.path.join(gridset_base_dir, "Grids", folder, "grid.xml")
        if os.path.exists(grid_xml_path):
            key_mappings = kvks_mappings.get(layer, {})
            if debugging:
                st.write(f"Modifying {grid_xml_path} with layer: {layer}")
            modify_grid_xml_with_layer(grid_xml_path, key_mappings)


# After the other function definitions but before the main app logic
def add_language_to_gridset_settings(settings_xml_content: str, language_code: str, _) -> str:
    """
    Add or update language setting in GridSet settings.xml file
    
    Args:
        settings_xml_content: The XML content from settings.xml
        language_code: The language code to add (must be a valid Grid language code)
        _: Unused parameter kept for compatibility
    
    Returns:
        Updated XML content as string
    """
    if language_code not in GRID_SUPPORTED_LANGUAGES:
        raise ValueError(f"Invalid Grid language code: {language_code}")

    # Check if Language tag already exists
    if "<Language>" in settings_xml_content:
        # Replace existing language tag
        import re
        settings_xml_content = re.sub(
            r"<Language>[^<]+</Language>",
            f"<Language>{language_code}</Language>",
            settings_xml_content
        )
    else:
        # Add new language tag before closing GridSetSettings
        settings_xml_content = settings_xml_content.replace(
            "</GridSetSettings>",
            f"  <Language>{language_code}</Language>\n</GridSetSettings>"
        )

    return settings_xml_content


# ---------------------------------------------------------------------------
# Custom layout library (row/key JSON -> Grid 3 gridset)
# ---------------------------------------------------------------------------

def get_layout_library():
    """Return a list of {path, name, data} for every JSON layout in layouts/."""
    library = []
    for path in sorted(glob.glob(os.path.join(APP_DIR, LAYOUTS_DIR, "*.json"))):
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            if not isinstance(data.get("rows"), list) and not isinstance(data.get("pages"), list):
                continue  # Not a keyboard layout file
            library.append({
                "path": path,
                "name": data.get("layout", os.path.basename(path)),
                "data": data,
            })
        except (json.JSONDecodeError, OSError) as e:
            st.warning(f"Could not read layout `{path}`: {e}")
    return library


def run_node_generator(layout_data, include_workspace):
    """Run scripts/generate-gridset.mjs; return (gridset_bytes, summary_dict)."""
    with tempfile.TemporaryDirectory(prefix="layout_gen_") as tmp:
        layout_path = os.path.join(tmp, "layout.json")
        out_path = os.path.join(tmp, "keyboard.gridset")
        with open(layout_path, "w", encoding="utf-8") as f:
            json.dump(layout_data, f, ensure_ascii=False)

        cmd = ["node", GENERATOR_SCRIPT, layout_path, out_path]
        if not include_workspace:
            cmd.append("--no-workspace")

        proc = subprocess.run(cmd, capture_output=True, text=True, cwd=APP_DIR)

        summary = None
        if "---SUMMARY---" in proc.stdout:
            try:
                summary = json.loads(proc.stdout.split("---SUMMARY---", 1)[1].strip())
            except json.JSONDecodeError:
                summary = None

        if proc.returncode != 0 or not os.path.exists(out_path):
            error = summary.get("error") if summary else (proc.stderr or proc.stdout)[-2000:]
            raise RuntimeError(f"Generator failed: {error}")

        with open(out_path, "rb") as f:
            return f.read(), summary


@st.cache_data(show_spinner=False)
def build_layout_component_html(bundle_path, bundle_mtime, payload_json):
    """Build the self-contained in-browser generator component.

    The bundle (static/layout-generator.js) plus the selected layout JSON are
    inlined so the component can generate the gridset entirely client-side.
    """
    with open(bundle_path, "r", encoding="utf-8") as f:
        bundle = f.read()
    safe_payload = payload_json.replace("</", "<\\/")

    html = f"""<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; }}
  .wrap {{ padding: 0.25rem 0; }}
  button#generate {{
    background-color: #ff4b4b; color: white; border: none; border-radius: 6px;
    padding: 0.45rem 1rem; font-size: 0.95rem; cursor: pointer;
  }}
  button#generate:disabled {{ opacity: 0.5; cursor: wait; }}
  #status {{ margin-top: 0.5rem; font-size: 0.9rem; }}
  #status.error {{ color: #d93025; }}
  a#download {{
    display: none; margin-top: 0.5rem; background-color: #21c354; color: white;
    text-decoration: none; border-radius: 6px; padding: 0.45rem 1rem;
    font-size: 0.95rem;
  }}
  ul#warnings {{ margin-top: 0.5rem; padding-left: 1.2rem; font-size: 0.85rem; color: #8a6d3b; }}
</style>
</head>
<body>
<div class="wrap">
  <button id="generate">Generate gridset in your browser</button>
  <div id="status"></div>
  <a id="download" href="#" download>Download gridset</a>
  <ul id="warnings"></ul>
</div>
<script>{bundle}</script>
<script>
(function () {{
  var payload = {safe_payload};
  var layout = payload.layout;
  var includeWorkspace = payload.workspace;

  var btn = document.getElementById('generate');
  var status = document.getElementById('status');
  var dl = document.getElementById('download');
  var warningsEl = document.getElementById('warnings');

  btn.addEventListener('click', async function () {{
    btn.disabled = true;
    status.className = '';
    status.textContent = 'Generating…';
    dl.style.display = 'none';
    warningsEl.innerHTML = '';
    try {{
      var result = await window.LayoutGeneratorBundle.generateGridset(layout, {{ includeWorkspace: includeWorkspace }});
      var blob = new Blob([result.bytes], {{ type: 'application/zip' }});
      var url = URL.createObjectURL(blob);
      dl.href = url;
      dl.download = result.filename;
      dl.textContent = 'Download ' + result.filename;
      dl.style.display = 'inline-block';
      status.textContent = 'Ready — ' + result.summary.pages + ' page(s), ' + result.summary.buttons + ' keys.';
      var v = result.summary.validation;
      if (v) {{
        var vEl = document.createElement('div');
        vEl.style.marginTop = '0.25rem';
        vEl.style.fontSize = '0.85rem';
        vEl.style.color = v.valid ? '#1e7e34' : '#d93025';
        vEl.textContent = (v.valid ? 'Verified: ' + (v.checks || []).length + ' checks passed'
                                   : 'Verification FAILED: ' + v.errors + ' error(s)') +
                          (v.warnings ? ' (' + v.warnings + ' warning(s))' : '');
        status.appendChild(vEl);
      }}
      (result.summary.warnings || []).forEach(function (w) {{
        var li = document.createElement('li');
        li.textContent = w;
        warningsEl.appendChild(li);
      }});
    }} catch (err) {{
      status.className = 'error';
      status.textContent = 'Error: ' + (err && err.message ? err.message : err);
    }} finally {{
      btn.disabled = false;
    }}
  }});
}})();
</script>
</body>
</html>"""
    return html


# Main application logic
if "keyboards" not in st.session_state:
    st.session_state.keyboards = []
if "selected_keyboard" not in st.session_state:
    st.session_state.selected_keyboard = None

st.write(
    "This tool allows you to create keyboard gridsets for Grid 3 in two ways:\n\n"
    "1. **Keyman keyboards** — remap a template gridset using [Keyman](http://keyman.com) keyboard definitions.\n"
    "2. **Layout library** — generate gridsets from simple row/key JSON layouts (e.g. the bundled Gujarati keyboard), "
    "either on the server or entirely in your browser.\n\n"
    "**Note:** Some keyboards require right-to-left input, so ensure your language settings are configured correctly. "
    "You may also need to use a suitable font to display certain characters accurately."
)

tab_keyman, tab_layout = st.tabs(["Keyman keyboards", "Layout library (JSON)"])

# ---------------------------------------------------------------------------
# Tab 1: Keyman (existing flow, unchanged)
# ---------------------------------------------------------------------------

with tab_keyman:
    gridset_dir = unzip_template_gridset()  # Unzip template to a temporary directory

    language_query = st.text_input("Enter a language to search for:")

    if st.button("1. Search Keyboards"):
        if language_query:
            filtered_keyboards = search_keyboards(language_query)
            if filtered_keyboards:
                st.session_state.keyboards = filtered_keyboards
            else:
                st.error("No keyboards found for the entered language in the KVKS index.")
        else:
            st.error("Please enter a language to search.")

    if st.session_state.keyboards:
        selected_keyboard = st.selectbox(
            "Choose a keyboard",
            st.session_state.keyboards,
            format_func=lambda k: f"{k['name']} ({k['id']})",
        )
        st.session_state.selected_keyboard = selected_keyboard

    if st.session_state.selected_keyboard:
        # Create list of language options
        language_options = [f"{code} ({name})" for code, (_, name) in GRID_SUPPORTED_LANGUAGES.items()]
        language_options.insert(0, "No language setting")

        # Try to find matching language for auto-selection
        keyboard = st.session_state.selected_keyboard
        default_index = 0  # Default to "No language setting"

        if debugging:
            st.write("Keyboard data:", keyboard)

        # Extract language code from keyboard data
        keyboard_lang = None
        if 'languageId' in keyboard:
            keyboard_lang = keyboard['languageId'].split('-')[0].lower()
        elif 'language' in keyboard:
            keyboard_lang = keyboard['language'].split('-')[0].lower()

        if keyboard_lang:
            if debugging:
                st.write(f"Found keyboard language: {keyboard_lang}")

            # Try to find best matching language
            for i, option in enumerate(language_options[1:], 1):  # Skip "No language setting"
                grid_code = option.split(" (")[0]
                grid_lang = GRID_SUPPORTED_LANGUAGES[grid_code][0]

                # Exact match
                if grid_lang.lower() == keyboard_lang:
                    default_index = i
                    # Prefer exact region match if available
                    if f"{keyboard_lang}-{keyboard.get('region', '').lower()}" == grid_code.lower():
                        break

                # Special cases for similar scripts
                elif keyboard_lang in ('ar', 'fa', 'ur') and grid_lang == 'ar':  # RTL scripts
                    default_index = i
                    break
                elif keyboard_lang in ('zh', 'ja', 'ko') and grid_lang == 'en':  # CJK -> default to English
                    default_index = language_options.index("en-US (English (US))")
                    break

        if debugging and default_index > 0:
            st.write(f"Auto-selected language: {language_options[default_index]}")

        selected_language_display = st.selectbox(
            "Add language setting to gridset - note this should match any language pack you have installed on Windows (optional):",
            language_options,
            index=default_index,
            help="Language setting is auto-selected based on keyboard language when possible"
        )

        if st.button("2. Download and Process Keyboard"):
            keyboard_choice = st.session_state.selected_keyboard
            keyboard_id = keyboard_choice["id"]

            if keyboard_id in kvks_index:
                github_link = kvks_index[keyboard_id]
                kvks_content = fetch_kvks_file(github_link)
                if kvks_content:
                    keyman_mappings = parse_kvks_content(kvks_content)
                    if debugging:
                        st.write(f"Extracted key mappings from KVKS: {keyman_mappings}")

                    # First modify the keyboard mappings
                    modify_gridset_with_kvks_layers(keyman_mappings, gridset_dir)

                    # Then update the language setting if selected
                    if selected_language_display != "No language setting":
                        selected_language_code = selected_language_display.split(" (")[0]
                        settings_path = os.path.join(gridset_dir, "Settings0", "settings.xml")

                        if os.path.exists(settings_path):
                            with open(settings_path, "r", encoding="utf-8") as f:
                                settings_content = f.read()

                            try:
                                # Add or update language setting
                                updated_settings = add_language_to_gridset_settings(
                                    settings_content,
                                    selected_language_code,
                                    None
                                )

                                # Write back updated settings
                                with open(settings_path, "w", encoding="utf-8") as f:
                                    f.write(updated_settings)

                                if debugging:
                                    st.write(f"Updated settings.xml with language: {selected_language_code}")

                            except ValueError as e:
                                st.error(f"Error updating language setting: {e}")

                    # Create the final gridset file
                    try:
                        modified_gridset_io = io.BytesIO()
                        with zipfile.ZipFile(modified_gridset_io, "w") as zipf:
                            for root, dirs, files in os.walk(gridset_dir):
                                for file in files:
                                    full_path = os.path.join(root, file)
                                    relative_path = os.path.relpath(full_path, gridset_dir)
                                    zipf.write(full_path, relative_path)

                        modified_gridset_io.seek(0)
                        filename = f"{keyboard_id}.gridset"
                        if debugging:
                            st.write(f"Successfully created zip file: {filename}")
                        st.download_button("3. Download Modified Gridset", modified_gridset_io.getvalue(), filename)
                    except Exception as e:
                        st.error(f"Failed to create zip file: {e}")
                else:
                    st.error(f"Failed to fetch KVKS file from {github_link}")
            else:
                st.error(f"Keyboard {keyboard_id} not found in KVKS index.")

            # Delete the temporary directory after processing
            shutil.rmtree(gridset_dir, ignore_errors=True)

# ---------------------------------------------------------------------------
# Tab 2: Layout library (JSON -> gridset)
# ---------------------------------------------------------------------------

with tab_layout:
    st.write(
        "Generate a Grid 3 gridset from a row/key JSON layout. "
        "See `layouts/README.md` for the format — copy an existing layout, edit the keys, "
        "and drop the file into the `layouts/` folder to add it to the library."
    )

    library = get_layout_library()
    source = st.radio(
        "Layout source",
        ["Built-in layout library", "Upload your own JSON"],
        horizontal=True,
    )

    layout_data = None
    layout_label = None

    if source == "Built-in layout library":
        if not library:
            st.warning(
                "No layouts found in the `layouts/` folder. "
                "Upload a JSON below or add files to `layouts/`."
            )
        else:
            labels = [f"{item['name']} ({os.path.basename(item['path'])})" for item in library]
            chosen = st.selectbox("Choose a layout", labels)
            layout_data = library[labels.index(chosen)]["data"]
            layout_label = chosen
    else:
        uploaded = st.file_uploader("Upload a layout JSON file", type=["json"])
        if uploaded is not None:
            try:
                layout_data = json.loads(uploaded.getvalue().decode("utf-8"))
                layout_label = uploaded.name
                st.success(f"Loaded `{uploaded.name}`.")
            except (json.JSONDecodeError, UnicodeDecodeError) as e:
                st.error(f"Could not parse JSON: {e}")

        if layout_data is not None:
            with st.expander("Save this layout to the library"):
                save_name = st.text_input(
                    "File name",
                    value=os.path.splitext(layout_label)[0].replace(" ", "-").lower() + ".json",
                )
                if st.button("Save to layouts/"):
                    if not save_name.endswith(".json"):
                        save_name += ".json"
                    save_path = os.path.join(APP_DIR, LAYOUTS_DIR, os.path.basename(save_name))
                    try:
                        os.makedirs(os.path.join(APP_DIR, LAYOUTS_DIR), exist_ok=True)
                        with open(save_path, "w", encoding="utf-8") as f:
                            json.dump(layout_data, f, ensure_ascii=False, indent=2)
                        st.success(f"Saved to `{save_path}` — it now appears in the library.")
                        st.rerun()
                    except OSError as e:
                        st.error(f"Could not save layout: {e}")

    if layout_data is not None:
        include_workspace = st.checkbox(
            "Add a chat workspace (message bar) row at the top",
            value=layout_data.get("workspace", True),
        )

        browser_available = os.path.exists(os.path.join(APP_DIR, BROWSER_BUNDLE))
        node_available = shutil.which("node") is not None

        if not browser_available and not node_available:
            st.error(
                "No generator available: build the browser bundle with `npm run build:browser` "
                "or install Node.js for server-side generation."
            )
        else:
            engine_options = []
            if browser_available:
                engine_options.append("In your browser (no upload needed)")
            if node_available:
                engine_options.append("On the server (Node.js)")

            engine = st.radio("Generate", engine_options, horizontal=True)

            if engine.startswith("In your browser"):
                payload = {
                    "layout": layout_data,
                    "workspace": include_workspace,
                }
                bundle_path = os.path.join(APP_DIR, BROWSER_BUNDLE)
                html = build_layout_component_html(
                    bundle_path,
                    os.path.getmtime(bundle_path),
                    json.dumps(payload, ensure_ascii=False),
                )
                components.html(html, height=320)
            else:
                if st.button("Generate Gridset"):
                    try:
                        with st.spinner("Generating gridset…"):
                            gridset_bytes, summary = run_node_generator(layout_data, include_workspace)
                        filename = f"{layout_data.get('layout', 'keyboard').replace(' ', '-').lower()}.gridset"
                        st.download_button(
                            "Download Gridset",
                            gridset_bytes,
                            filename,
                            mime="application/zip",
                        )
                        if summary:
                            st.caption(
                                f"{summary.get('pages')} page(s), {summary.get('buttons')} keys, "
                                f"locale {summary.get('locale')}."
                            )
                            validation = summary.get("validation") or {}
                            if validation.get("valid"):
                                check_count = len(validation.get("checks", []))
                                st.success(
                                    f"Verified with aac-processors: {check_count} checks passed"
                                    + (f", {validation['warnings']} warnings" if validation.get("warnings") else "")
                                    + "."
                                )
                            else:
                                st.error(
                                    f"Verification failed: {validation.get('errors')} error(s), "
                                    f"{validation.get('warnings')} warning(s)."
                                )
                            for w in summary.get("warnings", []):
                                st.warning(w)
                    except RuntimeError as e:
                        st.error(str(e))
