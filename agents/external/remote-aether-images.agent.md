---
id: remote-aether-images
name: Remote AETHER Image Instance
tier: master
sections: [META]
capabilities: [image-generation, text-to-image, image-editing, remote-inference]
dependencies: []
llmRequirement: opus
format: json
escalationTarget: null
transport:
  type: federation
  instanceUrl: ws://image-aether.local:9999
  remoteAgentId: nano-banana-pro
  channel: /federation/images
  timeout: 120000
---

# Remote AETHER Image Instance

A federated master agent that connects to a separate AETHER instance
dedicated to image generation. This enables distributed agent networks
where specialized instances handle domain-specific tasks.

## Architecture
```
┌─────────────────────┐     WebSocket     ┌─────────────────────┐
│  Main AETHER        │ ◄──────────────►  │  Image AETHER       │
│  (this instance)    │    Federation     │  (remote instance)  │
│                     │                   │                     │
│  ┌───────────────┐  │                   │  ┌───────────────┐  │
│  │ remote-aether │──┼───────────────────┼──│ nano-banana   │  │
│  │ -images       │  │    BAP-01 msg     │  │ -pro          │  │
│  └───────────────┘  │                   │  └───────────────┘  │
└─────────────────────┘                   └─────────────────────┘
```

## Usage
Any agent in this instance can request image generation by targeting
`remote-aether-images` or the `image-generation` capability. The
federation transport will forward the task to the remote instance's
`nano-banana-pro` agent transparently.
