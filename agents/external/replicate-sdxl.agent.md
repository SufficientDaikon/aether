---
id: replicate-sdxl
name: Replicate SDXL
tier: worker
sections: [META]
capabilities: [image-generation, text-to-image, sdxl]
dependencies: []
llmRequirement: sonnet
format: json
escalationTarget: nano-banana-pro
transport:
  type: api
  endpoint: https://api.replicate.com/v1/predictions
  method: POST
  authType: bearer
  authEnvVar: REPLICATE_API_TOKEN
  requestMapping:
    description: input.prompt
    context.negative_prompt: input.negative_prompt
    context.width: input.width
    context.height: input.height
  responseMapping:
    output: output
    status: status
  polling:
    statusEndpoint: https://api.replicate.com/v1/predictions/{{jobId}}
    jobIdField: id
    completionField: status
    completionValue: succeeded
    resultField: output
    intervalMs: 3000
    maxPolls: 40
---

# Replicate SDXL — Image Generation Worker

A worker-tier image generation agent using Replicate's SDXL endpoint.
Escalates to Nano Banana Pro on failure.
