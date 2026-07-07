import type { Locale } from "./i18n.js";
import { translateStaticText } from "./static-translations.js";

const TRANSLATABLE_ATTRIBUTES = [
  "aria-label",
  "aria-description",
  "placeholder",
  "title",
] as const;

const SKIP_TEXT_TAGS = new Set([
  "CODE",
  "KBD",
  "PRE",
  "SAMP",
  "SCRIPT",
  "STYLE",
  "TEXTAREA",
]);

const TEXT_NODES_PER_FLUSH = 150;
const ATTRIBUTE_ELEMENTS_PER_FLUSH = 150;
const ATTRIBUTE_SELECTOR = TRANSLATABLE_ATTRIBUTES.map((attr) => `[${attr}]`).join(",");

const originalText = new WeakMap<Text, string>();
const originalAttributes = new WeakMap<Element, Map<string, string>>();
const translatedTextNodes = new Set<Text>();
const translatedAttributeElements = new Set<Element>();

type TranslationJob =
  | {
      kind: "text";
      node: Text;
    }
  | {
      kind: "attributes";
      node: Element;
    }
  | {
      kind: "element";
      node: Element;
      walker: TreeWalker;
      textDone: boolean;
      rootAttributesDone: boolean;
      attributeElements: Element[] | null;
      attributeIndex: number;
    };

interface TranslationBudget {
  textNodes: number;
  attributeElements: number;
}

export function getStaticDomTranslationObserverOptions(): MutationObserverInit {
  return {
    childList: true,
    subtree: true,
  };
}

export function getStaticDomTranslationBatchLimits() {
  return {
    textNodesPerFlush: TEXT_NODES_PER_FLUSH,
    attributeElementsPerFlush: ATTRIBUTE_ELEMENTS_PER_FLUSH,
  };
}

export function syncStaticDomTranslations(locale: Locale): () => void {
  if (typeof document === "undefined" || !document.body) {
    return () => {};
  }

  if (locale !== "en") {
    const scheduler = createTranslationScheduler(locale);
    for (const node of [...translatedTextNodes]) {
      scheduler.enqueue(node);
    }
    for (const element of [...translatedAttributeElements]) {
      scheduler.enqueueAttributes(element);
    }
    return scheduler.cancel;
  }

  const scheduler = createTranslationScheduler(locale);
  scheduler.enqueue(document.body);

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        scheduler.enqueue(node);
      }
    }
  });

  observer.observe(document.body, getStaticDomTranslationObserverOptions());

  return () => {
    observer.disconnect();
    scheduler.cancel();
  };
}

function createTranslationScheduler(locale: Locale) {
  const queuedNodes = new Set<Node>();
  const jobs: TranslationJob[] = [];
  let cancelScheduled: (() => void) | null = null;

  function flush() {
    cancelScheduled = null;
    const budget: TranslationBudget = {
      textNodes: TEXT_NODES_PER_FLUSH,
      attributeElements: ATTRIBUTE_ELEMENTS_PER_FLUSH,
    };

    while (jobs.length > 0 && hasBudget(budget)) {
      const job = jobs[0];
      const done = processTranslationJob(job, locale, budget);
      if (!done) {
        break;
      }

      queuedNodes.delete(job.node);
      jobs.shift();
    }

    if (jobs.length > 0) {
      cancelScheduled = scheduleAfterRender(flush);
    }
  }

  function enqueue(node: Node) {
    if (queuedNodes.has(node)) {
      return;
    }

    const job = createTranslationJob(node);
    if (!job) {
      return;
    }

    queuedNodes.add(node);
    jobs.push(job);

    scheduleFlush();
  }

  function enqueueAttributes(element: Element) {
    if (queuedNodes.has(element)) {
      return;
    }

    queuedNodes.add(element);
    jobs.push({
      kind: "attributes",
      node: element,
    });

    scheduleFlush();
  }

  function scheduleFlush() {
    if (cancelScheduled) {
      return;
    }

    cancelScheduled = scheduleAfterRender(flush);
  }

  function cancel() {
    queuedNodes.clear();
    jobs.splice(0, jobs.length);
    cancelScheduled?.();
    cancelScheduled = null;
  }

  return { enqueue, enqueueAttributes, cancel };
}

function hasBudget(budget: TranslationBudget): boolean {
  return budget.textNodes > 0 || budget.attributeElements > 0;
}

function createTranslationJob(node: Node): TranslationJob | null {
  if (node instanceof Text) {
    return {
      kind: "text",
      node,
    };
  }

  if (node instanceof Element) {
    return {
      kind: "element",
      node,
      walker: document.createTreeWalker(node, NodeFilter.SHOW_TEXT, {
        acceptNode(candidate) {
          const parent = candidate.parentElement;
          if (!parent || SKIP_TEXT_TAGS.has(parent.tagName)) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      }),
      textDone: false,
      rootAttributesDone: false,
      attributeElements: null,
      attributeIndex: 0,
    };
  }

  return null;
}

function processTranslationJob(
  job: TranslationJob,
  locale: Locale,
  budget: TranslationBudget,
): boolean {
  if (job.kind === "text") {
    if (budget.textNodes <= 0) {
      return false;
    }

    translateTextNode(job.node, locale);
    budget.textNodes -= 1;
    return true;
  }

  if (job.kind === "attributes") {
    if (budget.attributeElements <= 0) {
      return false;
    }

    translateAttributes(job.node, locale);
    budget.attributeElements -= 1;
    return true;
  }

  if (!job.rootAttributesDone) {
    if (budget.attributeElements <= 0) {
      return false;
    }

    translateAttributes(job.node, locale);
    budget.attributeElements -= 1;
    job.rootAttributesDone = true;
  }

  while (!job.textDone && budget.textNodes > 0) {
    if (!job.walker.nextNode()) {
      job.textDone = true;
      break;
    }

    translateTextNode(job.walker.currentNode as Text, locale);
    budget.textNodes -= 1;
  }

  if (!job.textDone) {
    return false;
  }

  if (!job.attributeElements) {
    job.attributeElements = [...job.node.querySelectorAll(ATTRIBUTE_SELECTOR)];
  }

  while (
    job.attributeIndex < job.attributeElements.length &&
    budget.attributeElements > 0
  ) {
    translateAttributes(job.attributeElements[job.attributeIndex], locale);
    job.attributeIndex += 1;
    budget.attributeElements -= 1;
  }

  return job.attributeIndex >= job.attributeElements.length;
}

function scheduleAfterRender(callback: () => void): () => void {
  if (typeof window === "undefined") {
    callback();
    return () => {};
  }

  const idleWindow = window as Window & {
    requestIdleCallback?: (
      callback: IdleRequestCallback,
      options?: IdleRequestOptions,
    ) => number;
    cancelIdleCallback?: (handle: number) => void;
  };

  if (typeof idleWindow.requestIdleCallback === "function") {
    const handle = idleWindow.requestIdleCallback(() => callback(), {
      timeout: 300,
    });
    return () => idleWindow.cancelIdleCallback?.(handle);
  }

  const handle = window.setTimeout(callback, 0);
  return () => window.clearTimeout(handle);
}

function translateTextNode(node: Text, locale: Locale) {
  if (locale !== "en") {
    const original = originalText.get(node);
    if (original !== undefined && node.nodeValue !== original) {
      node.nodeValue = original;
    }
    originalText.delete(node);
    translatedTextNodes.delete(node);
    return;
  }

  const value = originalText.get(node) ?? node.nodeValue ?? "";
  const translated = translateStaticText(value, locale);
  if (translated !== value && node.nodeValue !== translated) {
    originalText.set(node, value);
    translatedTextNodes.add(node);
    node.nodeValue = translated;
  }
}

function translateAttributes(element: Element, locale: Locale) {
  let originals = originalAttributes.get(element);

  for (const attr of TRANSLATABLE_ATTRIBUTES) {
    const current = element.getAttribute(attr);
    if (current === null) {
      continue;
    }

    if (locale !== "en") {
      const original = originals?.get(attr);
      if (original !== undefined && current !== original) {
        element.setAttribute(attr, original);
      }
      originals?.delete(attr);
      continue;
    }

    const original = originals?.get(attr) ?? current;
    const translated = translateStaticText(original, locale);
    if (translated !== original) {
      if (!originals) {
        originals = new Map();
        originalAttributes.set(element, originals);
      }
      originals.set(attr, original);
      translatedAttributeElements.add(element);
      element.setAttribute(attr, translated);
    }
  }

  if (locale !== "en" && originals?.size === 0) {
    originalAttributes.delete(element);
    translatedAttributeElements.delete(element);
  }
}
