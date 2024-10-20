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
debugging = True

# Global variables
keyman_api_url = "https://api.keyman.com/search/2.0"
default_gridset_template = "template.gridset"
default_obf_template = "template.obf"

# Load the KVKS index JSON file
with open("kvks_index.json", "r") as f:
    kvks_index = json.load(f)


# Function to unzip a .gridset or .obf file into a temporary directory
def unzip_template(file_path):
    temp_dir = tempfile.mkdtemp(prefix="template_unzipped_")
    with zipfile.ZipFile(file_path, "r") as zip_ref:
        zip_ref.extractall(temp_dir)
    if debugging:
        st.write(f"Template unzipped to: {temp_dir}")
    return temp_dir


# Function to parse KVKS content and extract layer mappings
def parse_kvks_content(kvks_content):
    tree = ET.ElementTree(ET.fromstring(kvks_content))
    root = tree.getroot()
    layers_mapping = {}
    for layer in root.findall(".//layer"):
        shift_state = layer.get("shift", "")
        key_mappings = {
            key.get("vkey"): key.text or "" for key in layer.findall(".//key")
        }
        layers_mapping[shift_state] = key_mappings
    return layers_mapping


# Function to modify OBF XML with key mappings
def modify_obf_with_layer(obf_xml_path, key_mappings):
    try:
        tree = ET.parse(obf_xml_path)
        root = tree.getroot()
        replacements_count = 0

        for cell in root.findall(
            ".//Button"
        ):  # Adjust this path as per OBF's structure
            caption = cell.find("Label")  # Modify based on OBF structure
            if caption is not None and caption.text:
                current_caption = caption.text.strip()
                vkey = f"K_{current_caption.upper()}"
                if vkey in key_mappings:
                    new_character = key_mappings[vkey]
                    caption.text = new_character
                    replacements_count += 1

        tree.write(obf_xml_path)
        if debugging:
            st.write(f"Modified {replacements_count} keys in {obf_xml_path}")

    except ET.ParseError as e:
        st.error(f"XML Parsing Error: {e}")
    except Exception as e:
        st.error(f"An unexpected error occurred: {e}")


# Modify both gridset and OBF files based on the layers in KVKS
def modify_files_with_kvks_layers(kvks_mappings, template_dir, output_format="gridset"):
    if output_format == "gridset":
        folder_to_layer_mapping = {
            "default": "",
            "shift": "S",
            "ctrl": "C",
            "shift_ctrl": "SC",
            "alt": "RA",
            "shift_alt": "SRA",
            "ctrl_alt": "CRA",
            "shift_ctrl_alt": "SCA",
        }
        for folder, layer in folder_to_layer_mapping.items():
            grid_xml_path = os.path.join(template_dir, "Grids", folder, "grid.xml")
            if os.path.exists(grid_xml_path):
                key_mappings = kvks_mappings.get(layer, {})
                modify_grid_xml_with_layer(grid_xml_path, key_mappings)

    elif output_format == "obf":
        obf_xml_path = os.path.join(
            template_dir, "obf_keyboard.xml"
        )  # Example OBF file
        for layer, key_mappings in kvks_mappings.items():
            modify_obf_with_layer(obf_xml_path, key_mappings)


# UI for selecting output format and file upload
st.write("Choose the output format:")
output_format = st.radio("Output Format", ["gridset", "obf"])

# File upload
uploaded_file = st.file_uploader(
    "Upload your custom gridset or OBF template file", type=["gridset", "obf"]
)

# Determine template path based on upload or default
template_path = (
    uploaded_file
    if uploaded_file
    else (
        default_gridset_template if output_format == "gridset" else default_obf_template
    )
)

# Unzip the template and proceed with modifications if a keyboard is selected
if st.session_state.get("selected_keyboard") and st.button(
    "Download and Process Keyboard"
):
    keyboard_choice = st.session_state.selected_keyboard
    keyboard_id = keyboard_choice["id"]

    if keyboard_id in kvks_index:
        github_link = kvks_index[keyboard_id]
        kvks_content = fetch_kvks_file(github_link)
        if kvks_content:
            keyman_mappings = parse_kvks_content(kvks_content)
            template_dir = unzip_template(template_path)

            # Modify the files in the template directory based on KVKS layers
            modify_files_with_kvks_layers(keyman_mappings, template_dir, output_format)

            # Repack the modified template for download
            try:
                output_file = io.BytesIO()
                with zipfile.ZipFile(output_file, "w") as zipf:
                    for root, dirs, files in os.walk(template_dir):
                        for file in files:
                            full_path = os.path.join(root, file)
                            relative_path = os.path.relpath(full_path, template_dir)
                            zipf.write(full_path, relative_path)

                output_file.seek(0)
                filename = f"{keyboard_id}.{output_format}"
                st.download_button(
                    f"Download Modified {output_format.upper()}",
                    output_file.getvalue(),
                    filename,
                )
            except Exception as e:
                st.error(f"Failed to create zip file: {e}")
        else:
            st.error(f"Failed to fetch KVKS file from {github_link}")
    else:
        st.error(f"Keyboard {keyboard_id} not found in KVKS index.")
