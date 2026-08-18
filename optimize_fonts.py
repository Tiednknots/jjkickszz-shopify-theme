import glob
import os

files = glob.glob("/Users/Filthy/Library/Mobile Documents/com~apple~CloudDocs/Documents/GitHub/The Vault/may1-extract/snippets/header-*.liquid")
files.append("/Users/Filthy/Library/Mobile Documents/com~apple~CloudDocs/Documents/GitHub/The Vault/may1-extract/snippets/__default-head.liquid")

for file in files:
    with open(file, 'r', encoding='utf-8') as f:
        content = f.read()

    # Define the old and new content
    old_script_1 = '<script src="https://ajax.googleapis.com/ajax/libs/webfont/1.6.26/webfont.js" type="text/javascript"></script>'
    old_script_2 = '<script type="text/javascript">WebFont.load({\ngoogle: {\nfamilies: ["Droid Serif:400,400italic,700,700italic","Zalando Sans Expanded:300,400,500,600,700"]\n}});</script>'

    new_css = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Droid+Serif:ital,wght@0,400;0,700;1,400;1,700&display=swap">'

    if old_script_1 in content:
        content = content.replace(old_script_1, new_css)
        content = content.replace(old_script_2, '')
        with open(file, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f"Updated font loading in {os.path.basename(file)}")
