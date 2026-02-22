# ComfyUI Modusnap Custom Manager (Private)

Custom-node-only package that connects ComfyUI to Modusnap Engine manager APIs.

## Included nodes
- `Modusnap Manager Status`
- `Modusnap Manager Catalog`
- `Modusnap Manager Batch Install`

## Engine API key setup
1. Open Modusnap Engine UI (`http://localhost:3001`).
2. Open **Settings**.
3. In **Engine API Key (for Custom Manager)** click **Create API Key**.
4. Copy the key and paste it into the `api_key` field of these custom nodes.

## Install
1. Clone this repo into `ComfyUI/custom_nodes/ComfyUI-Modusnap-Custom-Manager`.
2. Restart ComfyUI.
3. Use nodes under category `modusnap/manager`.

## Notes
- This repo is intentionally custom-node only.
- It does not include the full Modusnap monorepo.
