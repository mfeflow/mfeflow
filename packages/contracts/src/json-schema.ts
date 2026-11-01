import { SCHEMA_URLS, type SchemaName } from './docs';
import { ENTRY_TYPES, GLOBAL_NAME } from './entry';
import {
  ENV_KEY,
  FEATURE_NAME,
  IDENT,
  JOB_ID,
  DEPENDENCY_NAME,
  PACKAGE,
  SCRIPT_NAME,
  TARGET,
  TRANSFORM_OPS,
} from './feature';
import { ANALYTICS_EVENT, EVENT_NAME, EXPOSE, MFE_NAME, ROUTE } from './mfe-manifest';
import {
  CHECKOUT_PATH,
  FILE_HASH,
  PROJECT_REPOS,
  REGISTRY_HOST,
  REGISTRY_NAMESPACE,
  SCOPE,
  SEMVER,
} from './project';
import { SAFE_RELATIVE_PATH } from './validate';
import { VERSION } from './registry';
import {
  MAX_DESCRIPTION,
  MAX_INDEX_ITEMS,
  MAX_KEYWORD,
  MAX_KEYWORDS,
  REGISTRY_ITEM_NAME,
} from './feature-registry';

type Json = Record<string, unknown>;

const DRAFT = 'https://json-schema.org/draft/2020-12/schema';

const str = (pattern?: RegExp): Json =>
  pattern ? { type: 'string', pattern: pattern.source } : { type: 'string' };
const strings = (pattern?: RegExp): Json => ({ type: 'array', items: str(pattern) });
/** https, or plain http on a loopback host; `registryTemplateProblem` is the full check. */
const REGISTRY_URL =
  /^(?:https:\/\/|http:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?:[:/?#])).*\{name\}/;
const literal: Json = { type: ['string', 'number', 'boolean', 'null'] };
const literalMap: Json = { type: 'object', additionalProperties: literal };
const url: Json = { type: 'string', format: 'uri', pattern: '^https?://' };
const relativePath: Json = { type: 'string', pattern: SAFE_RELATIVE_PATH.source };
const exposeFiles: Json = {
  type: 'object',
  propertyNames: str(EXPOSE),
  additionalProperties: { type: 'array', items: url },
};

function root(
  name: SchemaName,
  title: string,
  body: { properties: Json; required: string[] },
): Json {
  return {
    $schema: DRAFT,
    $id: SCHEMA_URLS[name],
    title,
    type: 'object',
    properties: { $schema: { type: 'string' }, ...body.properties },
    required: body.required,
  };
}

const remoteFiles: Json = {
  remoteEntry: url,
  type: { type: 'string', enum: [...ENTRY_TYPES] },
  entryGlobalName: str(GLOBAL_NAME),
  exposes: exposeFiles,
};

const when: Json = {
  type: 'object',
  minProperties: 1,
  propertyNames: str(IDENT),
  additionalProperties: { type: ['string', 'boolean'] },
};

const target: Json = str(TARGET);

const transformBase = {
  file: relativePath,
  target,
  when,
};

function op(name: string, required: string[], properties: Json): Json {
  return {
    type: 'object',
    properties: { op: { const: name }, ...transformBase, ...properties },
    required: ['op', 'file', ...required],
  };
}

const defaultImport: Json = { type: 'boolean' };

const transform: Json = {
  type: 'object',
  properties: { op: { enum: [...TRANSFORM_OPS] } },
  required: ['op'],
  oneOf: [
    op('add-import', ['from'], {
      from: str(),
      named: strings(IDENT),
      default: str(IDENT),
      namespace: str(IDENT),
      typeOnly: { type: 'boolean' },
    }),
    op('wrap-provider', ['component', 'from'], {
      component: str(IDENT),
      from: str(),
      props: literalMap,
      defaultImport,
      function: str(IDENT),
    }),
    op('add-shared', ['name'], { name: str(PACKAGE), list: str(IDENT) }),
    op('add-boot-step', ['call', 'from'], {
      call: str(IDENT),
      from: str(),
      args: { type: 'array', items: literal },
      await: { type: 'boolean' },
      defaultImport,
      before: str(IDENT),
      after: str(IDENT),
      function: str(IDENT),
    }),
    op('add-env-key', ['key', 'scope', 'schema'], {
      key: str(ENV_KEY),
      scope: { enum: ['server', 'runtime'] },
      schema: str(),
      value: literal,
      object: str(IDENT),
      example: relativePath,
      configFiles: { type: 'array', items: relativePath },
    }),
    op('add-route', ['path', 'component', 'from'], {
      path: str(ROUTE),
      component: str(IDENT),
      from: str(),
      defaultImport,
      routes: str(IDENT),
    }),
    op('add-workflow-step', ['job', 'step'], {
      job: str(JOB_ID),
      after: str(),
      step: {
        type: 'object',
        properties: {
          name: str(),
          id: str(),
          uses: str(),
          run: str(),
          with: literalMap,
          env: literalMap,
          if: str(),
        },
        required: ['name'],
        anyOf: [{ required: ['uses'] }, { required: ['run'] }],
      },
    }),
  ],
};

const item = (properties: Json, required: string[]): Json => ({
  type: 'object',
  properties,
  required,
});

/**
 * Editor schemas for the six JSON documents mfeflow reads. They mirror the validators in this package; the
 * validators stay the authority (they also check things a schema cannot, like duplicate routes), so a document
 * can pass here and still fail `mfeflow validate`.
 */
export const JSON_SCHEMAS: Record<SchemaName, Json> = {
  mfe: root('mfe', 'mfe.json', {
    properties: {
      name: str(MFE_NAME),
      owner: str(),
      contact: str(),
      shells: strings(MFE_NAME),
      routes: { ...strings(ROUTE), uniqueItems: true },
      exposes: strings(EXPOSE),
      events: {
        type: 'object',
        properties: { publishes: strings(EVENT_NAME), consumes: strings(EVENT_NAME) },
        required: ['publishes', 'consumes'],
      },
      analyticsEvents: strings(ANALYTICS_EVENT),
      budgets: {
        type: 'object',
        properties: {
          initialJsKb: { type: 'number', minimum: 1 },
          lcpMs: { type: 'number', minimum: 1 },
        },
      },
      platform: { type: 'object', additionalProperties: { type: 'string' } },
    },
    required: ['name', 'owner', 'shells', 'routes', 'exposes'],
  }),

  project: root('project', 'mfeflow.json', {
    properties: {
      version: { const: 1 },
      cli: str(SEMVER),
      repo: { enum: [...PROJECT_REPOS] },
      topology: { enum: ['monorepo', 'polyrepo', 'hybrid'] },
      packageManager: { enum: ['pnpm', 'npm'] },
      scope: str(SCOPE),
      apps: {
        type: 'object',
        propertyNames: str(MFE_NAME),
        minProperties: 1,
        additionalProperties: item(
          {
            kind: { enum: ['shell', 'remote'] },
            path: str(),
            port: { type: 'integer', minimum: 1, maximum: 65535 },
          },
          ['kind', 'path'],
        ),
      },
      features: {
        type: 'object',
        propertyNames: str(FEATURE_NAME),
        additionalProperties: item({ version: str(), options: { type: 'object' } }, ['version']),
      },
      files: {
        type: 'object',
        propertyNames: relativePath,
        additionalProperties: str(FILE_HASH),
      },
      registries: {
        type: 'object',
        propertyNames: {
          type: 'string',
          pattern: REGISTRY_NAMESPACE.source,
          not: { const: '@mfeflow' },
        },
        additionalProperties: { type: 'string', pattern: REGISTRY_URL.source },
      },
      local: str(CHECKOUT_PATH),
      budget: {
        type: 'object',
        properties: Object.fromEntries(
          ['shellKb', 'remoteKb', 'lcpDeltaMs', 'baselineKb'].map((key) => [
            key,
            { type: 'number', minimum: 1 },
          ]),
        ),
      },
      registry: {
        type: 'object',
        properties: {
          host: str(REGISTRY_HOST),
          baseUrl: {
            type: 'string',
            pattern: String.raw`^(?:https://[^@\s?#]*[^/@\s?#]|http://(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?(?:/[^@\s?#]*[^/@\s?#])?)$`,
          },
        },
      },
    },
    required: ['version', 'topology', 'packageManager', 'scope', 'apps', 'features'],
  }),

  feature: root('feature', 'feature.json', {
    properties: {
      name: str(FEATURE_NAME),
      version: str(),
      description: str(),
      keywords: strings(),
      prompts: {
        type: 'array',
        items: item(
          {
            name: str(IDENT),
            type: { enum: ['boolean', 'string', 'select'] },
            message: str(),
            default: { type: ['string', 'boolean'] },
            choices: strings(),
          },
          ['name', 'type'],
        ),
      },
      requires: strings(FEATURE_NAME),
      conflicts: strings(FEATURE_NAME),
      files: {
        type: 'array',
        items: {
          ...item(
            {
              to: relativePath,
              target,
              when,
              from: relativePath,
              content: str(),
              template: { type: 'boolean' },
              atRoot: { type: 'boolean' },
            },
            ['to'],
          ),
          oneOf: [{ required: ['from'] }, { required: ['content'] }],
        },
      },
      dependencies: {
        type: 'array',
        items: item(
          { name: str(DEPENDENCY_NAME), range: str(), dev: { type: 'boolean' }, target, when },
          ['name', 'range'],
        ),
      },
      scripts: {
        type: 'array',
        items: item({ name: str(SCRIPT_NAME), command: str(), target, when }, ['name', 'command']),
      },
      transforms: { type: 'array', items: transform },
      migrations: {
        type: 'array',
        items: item({ from: str(), to: str(), module: relativePath }, ['from', 'to', 'module']),
      },
    },
    required: ['name', 'version'],
  }),

  registryEntry: root('registryEntry', 'registry entry', {
    properties: {
      version: str(VERSION),
      manifestUrl: url,
      ...remoteFiles,
      previous: str(VERSION),
      owner: str(),
      rollout: item(
        {
          candidate: str(VERSION),
          stable: str(VERSION),
          percent: { type: 'number', minimum: 0, maximum: 100 },
        },
        ['candidate', 'stable', 'percent'],
      ),
    },
    required: ['version', 'manifestUrl'],
  }),

  registryIndex: root('registryIndex', 'registry index', {
    properties: {
      shell: str(),
      env: str(),
      generatedAt: str(),
      remotes: {
        type: 'array',
        items: item(
          {
            name: str(MFE_NAME),
            entry: url,
            ...remoteFiles,
            version: str(),
            routes: strings(ROUTE),
            owner: str(),
            previous: str(),
            history: strings(),
            rolledBackFrom: str(),
          },
          ['name', 'entry'],
        ),
      },
    },
    required: ['remotes'],
  }),

  featureRegistryIndex: root('featureRegistryIndex', 'feature registry index', {
    properties: {
      items: {
        type: 'array',
        maxItems: MAX_INDEX_ITEMS,
        items: item(
          {
            name: str(REGISTRY_ITEM_NAME),
            version: str(),
            description: { type: 'string', maxLength: MAX_DESCRIPTION },
            keywords: {
              type: 'array',
              maxItems: MAX_KEYWORDS,
              items: { type: 'string', maxLength: MAX_KEYWORD },
            },
          },
          ['name', 'version', 'description'],
        ),
      },
    },
    required: ['items'],
  }),
};
