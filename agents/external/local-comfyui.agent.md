---
id: local-comfyui
name: Local ComfyUI
tier: worker
sections: [META]
capabilities: [image-generation, text-to-image, local-inference]
dependencies: []
llmRequirement: local
format: json
escalationTarget: nano-banana-pro
transport:
  type: cli
  command: python
  args: ["-m", "comfyui_api", "--headless"]
  inputFormat: stdin-json
  outputFormat: stdout-json
  timeout: 300000
  env:
    CUDA_VISIBLE_DEVICES: "0"
---

# Local ComfyUI — Local Image Generation

A worker-tier agent that runs image generation locally via ComfyUI.
Zero API cost — uses local GPU. Escalates to cloud agents on failure.
