// ─────────────────────────────────────────────────────────────
// AETHER Entity Memory
//
// Extracts and stores entity-level knowledge from task results.
// Agents working on "the auth module" accumulate facts about it
// across sessions. Future tasks get this entity context injected
// automatically.
// ─────────────────────────────────────────────────────────────

import type { EntityType, Entity, EntityFact } from "./types.ts";
import type { AetherStore } from "./storage/store.ts";

// ─────────────────────────────────────────────────────────────
// Entity Memory
// ─────────────────────────────────────────────────────────────

export class EntityMemory {
  private store: AetherStore;

  constructor(store: AetherStore) {
    this.store = store;
  }

  /**
   * Extract entities from text using pattern matching.
   * Returns a list of detected entities.
   */
  extractEntities(text: string): Array<{ name: string; type: EntityType }> {
    const entities: Array<{ name: string; type: EntityType }> = [];
    const seen = new Set<string>();

    // File paths
    const filePatterns = [
      /(?:^|\s)((?:\.\/|\/)?(?:[\w.-]+\/)+[\w.-]+\.\w+)/gm,
      /`((?:[\w.-]+\/)+[\w.-]+\.\w+)`/g,
    ];
    for (const pattern of filePatterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const name = match[1].trim();
        if (!seen.has(name)) {
          seen.add(name);
          entities.push({ name, type: "file" });
        }
      }
    }

    // Module/package names (import patterns)
    const modulePatterns = [
      /(?:from|import)\s+['"]([^'"]+)['"]/g,
      /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    ];
    for (const pattern of modulePatterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const name = match[1];
        if (!name.startsWith(".") && !seen.has(name)) {
          seen.add(name);
          entities.push({ name, type: "module" });
        }
      }
    }

    // API endpoints
    const apiPattern = /(?:GET|POST|PUT|DELETE|PATCH)\s+([/\w\-.:{}]+)/g;
    let apiMatch;
    while ((apiMatch = apiPattern.exec(text)) !== null) {
      const name = apiMatch[1];
      if (!seen.has(name)) {
        seen.add(name);
        entities.push({ name, type: "api" });
      }
    }

    // Config references
    const configPatterns = [/process\.env\.([\w]+)/g];
    for (const pattern of configPatterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const name = match[1];
        if (!seen.has(name)) {
          seen.add(name);
          entities.push({ name, type: "config" });
        }
      }
    }

    return entities;
  }

  /**
   * Process a task result — extract entities, save them, and
   * associate facts with each entity.
   */
  processTaskOutput(
    taskId: string,
    output: string,
    description: string,
  ): { entitiesFound: number; factsAdded: number } {
    const extracted = this.extractEntities(output + " " + description);
    let factsAdded = 0;

    for (const { name, type } of extracted) {
      const entityId = this.entityId(name, type);

      // Upsert entity
      const existing = this.store.getEntity(entityId);
      if (existing) {
        this.store.saveEntity({
          ...existing,
          lastUpdated: new Date().toISOString(),
        });
      } else {
        this.store.saveEntity({
          id: entityId,
          name,
          type,
          firstSeen: new Date().toISOString(),
          lastUpdated: new Date().toISOString(),
        });
      }

      // Extract a fact about this entity from the description
      const fact = this.extractFact(name, description);
      if (fact) {
        this.store.addEntityFact({
          id:
            "fact-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
          entityId,
          fact,
          sourceTask: taskId,
          confidence: 0.8,
          createdAt: new Date().toISOString(),
        });
        factsAdded++;
      }
    }

    return { entitiesFound: extracted.length, factsAdded };
  }

  /**
   * Get accumulated context about entities mentioned in a task.
   * Returns formatted text suitable for prompt injection.
   */
  getEntityContext(taskDescription: string, maxEntities: number = 5): string {
    const mentioned = this.extractEntities(taskDescription);
    if (mentioned.length === 0) return "";

    const sections: string[] = [];
    let count = 0;

    for (const { name, type } of mentioned) {
      if (count >= maxEntities) break;

      const entityId = this.entityId(name, type);
      const entity = this.store.getEntity(entityId);
      if (!entity) continue;

      const facts = this.store.getEntityFacts(entityId);
      if (facts.length === 0) continue;

      const factLines = facts
        .slice(0, 5)
        .map((f) => "  - " + f.fact)
        .join("\n");

      sections.push("[" + type + "] " + name + ":\n" + factLines);
      count++;
    }

    if (sections.length === 0) return "";

    return (
      "--- Entity Knowledge ---\n" +
      sections.join("\n\n") +
      "\n--- End Entity Knowledge ---"
    );
  }

  /** Get an entity by name and type */
  getEntity(name: string, type: EntityType): Entity | null {
    return this.store.getEntity(this.entityId(name, type));
  }

  /** Get all facts for an entity */
  getFacts(entityId: string): EntityFact[] {
    return this.store.getEntityFacts(entityId);
  }

  /** Add a fact manually */
  addFact(
    entityName: string,
    entityType: EntityType,
    fact: string,
    sourceTask?: string,
    confidence: number = 1.0,
  ): void {
    const entityId = this.entityId(entityName, entityType);

    if (!this.store.getEntity(entityId)) {
      this.store.saveEntity({
        id: entityId,
        name: entityName,
        type: entityType,
        firstSeen: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
      });
    }

    this.store.addEntityFact({
      id: "fact-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
      entityId,
      fact,
      sourceTask,
      confidence,
      createdAt: new Date().toISOString(),
    });
  }

  /** Find entities by type */
  findByType(type: EntityType): Entity[] {
    return this.store.findEntitiesByType(type);
  }

  /** Search entities by name */
  findByName(name: string): Entity[] {
    return this.store.findEntitiesByName(name);
  }

  /** Get recent facts across all entities */
  getRecentFacts(limit: number = 20): EntityFact[] {
    return this.store.getRecentEntityFacts(limit);
  }

  /** Delete an entity and all its facts */
  deleteEntity(entityId: string): void {
    this.store.deleteEntity(entityId);
  }

  // ── Private ────────────────────────────────────────────────

  private entityId(name: string, type: EntityType): string {
    return type + ":" + name.toLowerCase().replace(/[^a-z0-9/.-]/g, "-");
  }

  /**
   * Extract a concise fact about an entity from surrounding text.
   * Returns null if no meaningful fact can be extracted.
   */
  private extractFact(entityName: string, text: string): string | null {
    const sentences = text.split(/[.!?]\s+/);
    for (const sentence of sentences) {
      if (sentence.toLowerCase().includes(entityName.toLowerCase())) {
        const trimmed = sentence.trim();
        if (trimmed.length > 10 && trimmed.length < 500) {
          return trimmed;
        }
      }
    }

    if (text.length > 10 && text.length < 500) {
      return "Referenced in task: " + text.slice(0, 200);
    }

    return null;
  }
}
