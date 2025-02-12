import streamlit as st
import requests
import os
import xml.etree.ElementTree as ET
import io
import zipfile
import shutil
import json
import tempfile

# Streamlit setup
st.title("Dynamic Keyboard Layout Maker for AAC")

# Enable or disable debugging
debugging = False

# Global variables
keyman_api_url = "https://api.keyman.com/search/2.0"

# Load the KVKS index JSON file
with open("kvks_index.json", "r") as f:
    kvks_index = json.load(f)


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
def add_language_to_gridset_settings(settings_xml_content: str, language_code: str, encodings_data: list) -> str:
    """
    Add or update language setting in GridSet settings.xml file
    
    Args:
        settings_xml_content: The XML content from settings.xml
        language_code: The language code to add (e.g. 'ar-SA', 'en')
        encodings_data: List of language encoding dictionaries from encodings.json
    
    Returns:
        Updated XML content as string
    """
    # First validate the language code exists
    valid_codes = set()
    for lang in encodings_data:
        if lang['Name']:  # Only add non-empty names
            valid_codes.add(lang['Name'])
            # Also add two-letter code for partial matching
            if 'TwoLetterISOLanguageName' in lang:
                valid_codes.add(lang['TwoLetterISOLanguageName'])

    # Try exact match first
    if language_code not in valid_codes:
        # Try partial match with two-letter code
        two_letter_code = language_code.split('-')[0] if '-' in language_code else language_code
        if two_letter_code not in valid_codes:
            raise ValueError(f"Invalid language code: {language_code}")
        # Use two-letter code if no exact match
        language_code = two_letter_code

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


# Main application logic
if "keyboards" not in st.session_state:
    st.session_state.keyboards = []
if "selected_keyboard" not in st.session_state:
    st.session_state.selected_keyboard = None

gridset_dir = unzip_template_gridset()  # Unzip template to a temporary directory

st.write(
    "This tool allows you to create a template Gridset for the Grid3 with a keyboard layout for a given language. "
    "Keyboards are based on [Keyman](http://keyman.com). You may find 'basic' versions better for your use.\n\n"
    "**Note:** Some keyboards require right-to-left input, so ensure your language settings are configured correctly. "
    "You may also need to use a suitable font to display certain characters accurately."
)

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
    # Extract language options from encodings.json
    with open("encodings.json", "r") as f:
        encodings_data = json.load(f)["CC"]
        
    # Create list of language options in format "Name (DisplayName)" 
    language_options = [f"{lang['Name']} ({lang['DisplayName']})" for lang in encodings_data if lang['Name']]
    language_options.insert(0, "No language setting")
    
    # Try to find matching language for auto-selection
    keyboard = st.session_state.selected_keyboard
    default_index = 0  # Default to "No language setting"
    
    if debugging:
        st.write("Keyboard data:", keyboard)
    
    # Extract language code from keyboard data
    keyboard_lang = None
    if 'languageId' in keyboard:
        # Some keyboards use languageId
        keyboard_lang = keyboard['languageId'].split('-')[0].lower()
    elif 'language' in keyboard:
        # Some keyboards use language
        keyboard_lang = keyboard['language'].split('-')[0].lower()
    
    if keyboard_lang:
        if debugging:
            st.write(f"Found keyboard language: {keyboard_lang}")
            
        # Try to find matching language in encodings
        for i, option in enumerate(language_options):
            if option == "No language setting":
                continue
                
            # Extract language code from option (e.g., "ar-SA (Arabic (Saudi Arabia))" -> "ar-SA")
            option_lang_code = option.split(" (")[0]
            
            # Try matching with full code first
            if option_lang_code.lower() == keyboard_lang:
                default_index = i
                break
                
            # Then try matching with base code
            option_lang_base = option_lang_code.split('-')[0].lower()
            if option_lang_base == keyboard_lang:
                default_index = i
                break
            
            # Also try matching with TwoLetterISOLanguageName
            for lang in encodings_data:
                if (lang.get('TwoLetterISOLanguageName', '').lower() == keyboard_lang and 
                    f"{lang['Name']} ({lang['DisplayName']})" == option):
                    default_index = i
                    break
    
    if debugging and default_index > 0:
        st.write(f"Auto-selected language: {language_options[default_index]}")
    
    selected_language_display = st.selectbox(
        "Add language setting to gridset - note this should match any lanuage pack you have installed on Windows (optional):", 
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
                                encodings_data
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
        shutil.rmtree(gridset_dir, ignore_errors=True)