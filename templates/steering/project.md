---
scope: global
priority: 8
tags: [project, overview]
---

# Project Overview

This document describes the overall project context, goals, and constraints.
All agents should consider these guidelines when executing tasks.

## Goals

- Build a reliable, maintainable system
- Follow established coding conventions
- Prioritize correctness over performance
- Write clear, self-documenting code

## Constraints

- Zero external runtime dependencies where possible
- All code must pass TypeScript strict mode
- Tests are required for all new functionality
- Changes must be backward-compatible

## Architecture Principles

- Modular design with clear boundaries
- Barrel exports for clean public APIs
- Dependency injection over hard-coded dependencies
- Fail fast with clear error messages
