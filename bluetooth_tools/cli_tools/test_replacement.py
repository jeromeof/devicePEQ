#!/usr/bin/env python3
# Test script to verify keepalive filter replacement

with open('frida_airoha.js', 'r') as f:
    script_content = f.read()

# Apply the filter_keepalive replacement
filter_keepalive = True
if filter_keepalive:
    original_content = script_content
    script_content = script_content.replace(
        'const FILTER_KEEPALIVE = false;',
        'const FILTER_KEEPALIVE = true;'
    )

    # Verify replacement happened
    if 'const FILTER_KEEPALIVE = true;' in script_content:
        print('✅ Replacement successful')
    else:
        print('❌ Replacement FAILED')

    # Check if original was changed
    if original_content != script_content:
        print('✅ Script content was modified')
    else:
        print('❌ Script content unchanged')

    # Show the actual line after replacement
    for line in script_content.split('\n'):
        if 'const FILTER_KEEPALIVE' in line:
            print(f'   Result: {line.strip()}')
