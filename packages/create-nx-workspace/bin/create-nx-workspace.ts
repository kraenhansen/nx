import * as enquirer from 'enquirer';
import * as yargs from 'yargs';
import * as chalk from 'chalk';

import { CreateWorkspaceOptions } from '../src/create-workspace-options';
import { createWorkspace } from '../src/create-workspace';
import { isKnownPreset, Preset } from '../src/utils/preset/preset';
import { CLIErrorMessageConfig, output } from '../src/utils/output';
import { nxVersion } from '../src/utils/nx/nx-version';
import { pointToTutorialAndCourse } from '../src/utils/preset/point-to-tutorial-and-course';

import { yargsDecorator } from './decorator';
import { getThirdPartyPreset } from '../src/utils/preset/get-third-party-preset';
import {
  determineCI,
  determineDefaultBase,
  determineNxCloud,
  determinePackageManager,
} from '../src/internal-utils/prompts';
import {
  withAllPrompts,
  withCI,
  withGitOptions,
  withNxCloud,
  withOptions,
  withPackageManager,
} from '../src/internal-utils/yargs-options';
import { showNxWarning } from '../src/utils/nx/show-nx-warning';
import { printNxCloudSuccessMessage } from '../src/utils/nx/nx-cloud';
import { messages, recordStat } from '../src/utils/nx/ab-testing';
import { existsSync } from 'fs';

interface BaseArguments extends CreateWorkspaceOptions {
  preset: Preset;
}

interface NoneArguments extends BaseArguments {
  stack: 'none';
  workspaceType: 'package-based' | 'integrated' | 'standalone';
  js: boolean;
  appName: string | undefined;
}

interface ReactArguments extends BaseArguments {
  stack: 'react';
  workspaceType: 'standalone' | 'integrated';
  appName: string;
  framework: 'none' | 'next';
  style: string;
  bundler: 'webpack' | 'vite' | 'rspack';
  nextAppDir: boolean;
  e2eTestRunner: 'none' | 'cypress' | 'playwright';
}

interface AngularArguments extends BaseArguments {
  stack: 'angular';
  workspaceType: 'standalone' | 'integrated';
  appName: string;
  style: string;
  routing: boolean;
  standaloneApi: boolean;
  e2eTestRunner: 'none' | 'cypress' | 'playwright';
}

interface VueArguments extends BaseArguments {
  stack: 'vue';
  workspaceType: 'standalone' | 'integrated';
  appName: string;
  // framework: 'none' | 'nuxt';
  style: string;
  e2eTestRunner: 'none' | 'cypress' | 'playwright';
}

interface NodeArguments extends BaseArguments {
  stack: 'node';
  workspaceType: 'standalone' | 'integrated';
  appName: string;
  framework: 'express' | 'fastify' | 'koa' | 'nest';
  docker: boolean;
}

interface UnknownStackArguments extends BaseArguments {
  stack: 'unknown';
}

type Arguments =
  | NoneArguments
  | ReactArguments
  | AngularArguments
  | VueArguments
  | NodeArguments
  | UnknownStackArguments;

export const commandsObject: yargs.Argv<Arguments> = yargs
  .wrap(yargs.terminalWidth())
  .parserConfiguration({
    'strip-dashed': true,
    'dot-notation': true,
  })
  .command<Arguments>(
    // this is the default and only command
    '$0 [name] [options]',
    'Create a new Nx workspace',
    (yargs) =>
      withOptions(
        yargs
          .option('name', {
            describe: chalk.dim`Workspace name (e.g. org name)`,
            type: 'string',
          })
          .option('preset', {
            describe: chalk.dim`Customizes the initial content of your workspace. Default presets include: [${Object.values(
              Preset
            )
              .map((p) => `"${p}"`)
              .join(
                ', '
              )}]. To build your own see https://nx.dev/extending-nx/recipes/create-preset`,
            type: 'string',
          })
          .option('interactive', {
            describe: chalk.dim`Enable interactive mode with presets`,
            type: 'boolean',
            default: true,
          })
          .option('workspaceType', {
            describe: chalk.dim`The type of workspace to create`,
            choices: ['integrated', 'package-based', 'standalone'],
            type: 'string',
          })
          .option('appName', {
            describe: chalk.dim`The name of the app when using a monorepo with certain stacks`,
            type: 'string',
          })
          .option('style', {
            describe: chalk.dim`Stylesheet type to be used with certain stacks`,
            type: 'string',
          })
          .option('standaloneApi', {
            describe: chalk.dim`Use Standalone Components if generating an Angular app`,
            type: 'boolean',
          })
          .option('routing', {
            describe: chalk.dim`Add a routing setup for an Angular app`,
            type: 'boolean',
          })
          .option('bundler', {
            describe: chalk.dim`Bundler to be used to build the app`,
            type: 'string',
          })
          .option('framework', {
            describe: chalk.dim`Framework option to be used with certain stacks`,
            type: 'string',
          })
          .option('docker', {
            describe: chalk.dim`Generate a Dockerfile for the Node API`,
            type: 'boolean',
          })
          .option('nextAppDir', {
            describe: chalk.dim`Enable the App Router for Next.js`,
            type: 'boolean',
          })
          .option('e2eTestRunner', {
            describe: chalk.dim`Test runner to use for end to end (E2E) tests.`,
            choices: ['cypress', 'playwright', 'none'],
            type: 'string',
          }),
        withNxCloud,
        withCI,
        withAllPrompts,
        withPackageManager,
        withGitOptions
      ),

    async function handler(argv: yargs.ArgumentsCamelCase<Arguments>) {
      await main(argv).catch((error) => {
        const { version } = require('../package.json');
        output.error({
          title: `Something went wrong! v${version}`,
        });
        throw error;
      });
    },
    [
      normalizeArgsMiddleware,
      normalizeAndWarnOnDeprecatedPreset({
        // TODO(v18): Remove Empty and Core presets
        [Preset.Core]: Preset.NPM,
        [Preset.Empty]: Preset.Apps,
      }),
    ] as yargs.MiddlewareFunction<{}>[]
  )
  .help('help', chalk.dim`Show help`)
  .updateLocale(yargsDecorator)
  .version(
    'version',
    chalk.dim`Show version`,
    nxVersion
  ) as yargs.Argv<Arguments>;

async function main(parsedArgs: yargs.Arguments<Arguments>) {
  output.log({
    title: `Creating your v${nxVersion} workspace.`,
    bodyLines: [
      'To make sure the command works reliably in all environments, and that the preset is applied correctly,',
      `Nx will run "${parsedArgs.packageManager} install" several times. Please wait.`,
    ],
  });

  const workspaceInfo = await createWorkspace<Arguments>(
    parsedArgs.preset,
    parsedArgs
  );

  showNxWarning(parsedArgs.name);

  await recordStat({
    nxVersion,
    command: 'create-nx-workspace',
    useCloud: parsedArgs.nxCloud,
    meta: messages.codeOfSelectedPromptMessage('nxCloudCreation'),
  });

  if (parsedArgs.nxCloud && workspaceInfo.nxCloudInfo) {
    printNxCloudSuccessMessage(workspaceInfo.nxCloudInfo);
  }

  if (isKnownPreset(parsedArgs.preset)) {
    pointToTutorialAndCourse(parsedArgs.preset as Preset);
  } else {
    output.log({
      title: `Successfully applied preset: ${parsedArgs.preset}`,
    });
  }
}

function normalizeAndWarnOnDeprecatedPreset(
  deprecatedPresets: Partial<Record<Preset, Preset>>
): (argv: yargs.Arguments<Arguments>) => Promise<void> {
  return async (args: yargs.Arguments<Arguments>): Promise<void> => {
    if (!args.preset) return;
    if (deprecatedPresets[args.preset]) {
      output.addVerticalSeparator();
      output.note({
        title: `The "${args.preset}" preset is deprecated.`,
        bodyLines: [
          `The "${
            args.preset
          }" preset will be removed in a future Nx release. Use the "${
            deprecatedPresets[args.preset]
          }" preset instead.`,
        ],
      });
      args.preset = deprecatedPresets[args.preset] as Preset;
    }
  };
}

/**
 * This function is used to normalize the arguments passed to the command.
 * It would:
 * - normalize the preset.
 * @param argv user arguments
 */
async function normalizeArgsMiddleware(
  argv: yargs.Arguments<Arguments>
): Promise<void> {
  output.log({
    title:
      "Let's create a new workspace [https://nx.dev/getting-started/intro]",
  });

  try {
    let thirdPartyPreset: string | null;

    // Node options
    let docker: boolean;

    try {
      thirdPartyPreset = await getThirdPartyPreset(argv.preset);
    } catch (e) {
      output.error({
        title: `Could not find preset "${argv.preset}"`,
      });
      process.exit(1);
    }

    argv.name = await determineFolder(argv);

    if (thirdPartyPreset) {
      Object.assign(argv, {
        preset: thirdPartyPreset,
        appName: '',
        style: '',
      });
    } else {
      argv.stack = await determineStack(argv);
      const presetOptions = await determinePresetOptions(argv);
      Object.assign(argv, presetOptions);
    }

    const packageManager = await determinePackageManager(argv);
    const defaultBase = await determineDefaultBase(argv);
    const nxCloud = await determineNxCloud(argv);
    const ci = await determineCI(argv, nxCloud);

    Object.assign(argv, {
      nxCloud,
      packageManager,
      defaultBase,
      ci,
    });
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}

function invariant(
  predicate: string | number | boolean,
  message: CLIErrorMessageConfig
): asserts predicate is NonNullable<string | number> | true {
  if (!predicate) {
    output.error(message);
    process.exit(1);
  }
}

async function determineFolder(
  parsedArgs: yargs.Arguments<Arguments>
): Promise<string> {
  const folderName: string = parsedArgs._[0]
    ? parsedArgs._[0].toString()
    : parsedArgs.name;
  if (folderName) return folderName;

  const reply = await enquirer.prompt<{ folderName: string }>([
    {
      name: 'folderName',
      message: `Where would you like to create your workspace?`,
      initial: 'org',
      type: 'input',
    },
  ]);

  invariant(reply.folderName, {
    title: 'Invalid folder name',
    bodyLines: [`Folder name cannot be empty`],
  });

  invariant(!existsSync(reply.folderName), {
    title: 'That folder is already taken',
  });

  return reply.folderName;
}

async function determineStack(
  parsedArgs: yargs.Arguments<Arguments>
): Promise<'none' | 'react' | 'angular' | 'vue' | 'node' | 'unknown'> {
  if (parsedArgs.preset) {
    switch (parsedArgs.preset) {
      case Preset.Angular:
      case Preset.AngularStandalone:
      case Preset.AngularMonorepo:
        return 'angular';
      case Preset.React:
      case Preset.ReactStandalone:
      case Preset.ReactMonorepo:
      case Preset.NextJs:
      case Preset.NextJsStandalone:
        return 'react';
      case Preset.VueStandalone:
      case Preset.VueMonorepo:
        return 'vue';
      case Preset.Nest:
      case Preset.NodeStandalone:
      case Preset.Express:
        return 'node';
      case Preset.Apps:
      case Preset.NPM:
      case Preset.TS:
      case Preset.TsStandalone:
        return 'none';
      case Preset.WebComponents:
      case Preset.ReactNative:
      case Preset.Expo:
      default:
        return 'unknown';
    }
  }

  const { stack } = await enquirer.prompt<{
    stack: 'none' | 'react' | 'angular' | 'node' | 'vue';
  }>([
    {
      name: 'stack',
      message: `Which stack do you want to use?`,
      type: 'autocomplete',
      choices: [
        {
          name: `none`,
          message: `None:          Configures a TypeScript/JavaScript project with minimal structure.`,
        },
        {
          name: `react`,
          message: `React:         Configures a React application with your framework of choice.`,
        },
        {
          name: `vue`,
          message: `Vue:           Configures a Vue application with modern tooling.`,
        },
        {
          name: `angular`,
          message: `Angular:       Configures a Angular application with modern tooling.`,
        },
        {
          name: `node`,
          message: `Node:          Configures a Node API application with your framework of choice.`,
        },
      ],
    },
  ]);

  return stack;
}

async function determinePresetOptions(
  parsedArgs: yargs.Arguments<Arguments>
): Promise<Partial<Arguments>> {
  switch (parsedArgs.stack) {
    case 'none':
      return determineNoneOptions(parsedArgs);
    case 'react':
      return determineReactOptions(parsedArgs);
    case 'angular':
      return determineAngularOptions(parsedArgs);
    case 'vue':
      return determineVueOptions(parsedArgs);
    case 'node':
      return determineNodeOptions(parsedArgs);
    default:
      return parsedArgs;
  }
}

async function determineNoneOptions(
  parsedArgs: yargs.Arguments<NoneArguments>
): Promise<Partial<NoneArguments>> {
  let preset: Preset;
  let workspaceType: 'package-based' | 'standalone' | 'integrated' | undefined =
    undefined;
  let appName: string | undefined = undefined;
  let js: boolean | undefined;

  if (parsedArgs.preset) {
    preset = parsedArgs.preset;
  } else {
    workspaceType = await determinePackageBasedOrIntegratedOrStandalone();
    if (workspaceType === 'standalone') {
      preset = Preset.TsStandalone;
    } else if (workspaceType === 'integrated') {
      preset = Preset.Apps;
    } else {
      preset = Preset.NPM;
    }
  }

  if (parsedArgs.js !== undefined) {
    js = parsedArgs.js;
  } else if (preset === Preset.TsStandalone) {
    // Only standalone TS preset generates a default package, so we need to provide --js and --appName options.
    appName = parsedArgs.name;
    const reply = await enquirer.prompt<{ ts: 'Yes' | 'No' }>([
      {
        name: 'ts',
        message: `Would you like to use TypeScript with this project?`,
        type: 'autocomplete',
        choices: [
          {
            name: 'Yes',
          },
          {
            name: 'No',
          },
        ],
        initial: 'Yes' as any,
      },
    ]);
    js = reply.ts === 'No';
  }

  return { preset, js, appName };
}

async function determineReactOptions(
  parsedArgs: yargs.Arguments<ReactArguments>
): Promise<Partial<Arguments>> {
  let preset: Preset;
  let style: undefined | string = undefined;
  let appName: string;
  let bundler: undefined | 'webpack' | 'vite' | 'rspack' = undefined;
  let e2eTestRunner: undefined | 'none' | 'cypress' | 'playwright' = undefined;
  let nextAppDir = false;

  if (parsedArgs.preset && parsedArgs.preset !== Preset.React) {
    preset = parsedArgs.preset;
    if (
      preset === Preset.ReactStandalone ||
      preset === Preset.NextJsStandalone
    ) {
      appName = parsedArgs.appName ?? parsedArgs.name;
    } else {
      appName = await determineAppName(parsedArgs);
    }
  } else {
    const framework = await determineReactFramework(parsedArgs);

    // React Native and Expo only support integrated monorepos for now.
    // TODO(jack): Add standalone support for React Native and Expo.
    const workspaceType =
      framework === 'react-native' || framework === 'expo'
        ? 'integrated'
        : await determineStandaloneOrMonorepo();

    if (workspaceType === 'standalone') {
      appName = parsedArgs.name;
    } else {
      appName = await determineAppName(parsedArgs);
    }

    if (framework === 'nextjs') {
      if (workspaceType === 'standalone') {
        preset = Preset.NextJsStandalone;
      } else {
        preset = Preset.NextJs;
      }
    } else if (framework === 'react-native') {
      preset = Preset.ReactNative;
    } else if (framework === 'expo') {
      preset = Preset.Expo;
    } else {
      if (workspaceType === 'standalone') {
        preset = Preset.ReactStandalone;
      } else {
        preset = Preset.ReactMonorepo;
      }
    }
  }

  if (preset === Preset.ReactStandalone || preset === Preset.ReactMonorepo) {
    bundler = await determineReactBundler(parsedArgs);
    e2eTestRunner = await determineE2eTestRunner(parsedArgs);
  } else if (preset === Preset.NextJs || preset === Preset.NextJsStandalone) {
    nextAppDir = await determineNextAppDir(parsedArgs);
    e2eTestRunner = await determineE2eTestRunner(parsedArgs);
  }

  if (parsedArgs.style) {
    style = parsedArgs.style;
  } else if (
    preset === Preset.ReactStandalone ||
    preset === Preset.ReactMonorepo ||
    preset === Preset.NextJs ||
    preset === Preset.NextJsStandalone
  ) {
    const reply = await enquirer.prompt<{ style: string }>([
      {
        name: 'style',
        message: `Default stylesheet format`,
        initial: 'css' as any,
        type: 'autocomplete',
        choices: [
          {
            name: 'css',
            message: 'CSS',
          },
          {
            name: 'scss',
            message: 'SASS(.scss)       [ http://sass-lang.com   ]',
          },
          {
            name: 'less',
            message: 'LESS              [ http://lesscss.org     ]',
          },
          {
            name: 'styled-components',
            message:
              'styled-components [ https://styled-components.com            ]',
          },
          {
            name: '@emotion/styled',
            message:
              'emotion           [ https://emotion.sh                       ]',
          },
          {
            name: 'styled-jsx',
            message:
              'styled-jsx        [ https://www.npmjs.com/package/styled-jsx ]',
          },
        ],
      },
    ]);
    style = reply.style;
  }

  return { preset, style, appName, bundler, nextAppDir, e2eTestRunner };
}

async function determineVueOptions(
  parsedArgs: yargs.Arguments<VueArguments>
): Promise<Partial<Arguments>> {
  let preset: Preset;
  let style: undefined | string = undefined;
  let appName: string;
  let e2eTestRunner: undefined | 'none' | 'cypress' | 'playwright' = undefined;

  if (parsedArgs.preset) {
    preset = parsedArgs.preset;
  } else {
    const workspaceType = await determineStandaloneOrMonorepo();

    if (workspaceType === 'standalone') {
      preset = Preset.VueStandalone;
    } else {
      preset = Preset.VueMonorepo;
    }
  }

  if (preset === Preset.VueStandalone) {
    appName = parsedArgs.appName ?? parsedArgs.name;
  } else {
    appName = await determineAppName(parsedArgs);
  }

  e2eTestRunner = await determineE2eTestRunner(parsedArgs);

  if (parsedArgs.style) {
    style = parsedArgs.style;
  } else {
    const reply = await enquirer.prompt<{ style: string }>([
      {
        name: 'style',
        message: `Default stylesheet format`,
        initial: 'css' as any,
        type: 'autocomplete',
        choices: [
          {
            name: 'css',
            message: 'CSS',
          },
          {
            name: 'scss',
            message: 'SASS(.scss)       [ http://sass-lang.com   ]',
          },
          {
            name: 'less',
            message: 'LESS              [ http://lesscss.org     ]',
          },
          {
            name: 'none',
            message: 'None',
          },
        ],
      },
    ]);
    style = reply.style;
  }

  return { preset, style, appName, e2eTestRunner };
}

async function determineAngularOptions(
  parsedArgs: yargs.Arguments<AngularArguments>
): Promise<Partial<Arguments>> {
  let preset: Preset;
  let style: string;
  let appName: string;
  let standaloneApi: boolean;
  let e2eTestRunner: undefined | 'none' | 'cypress' | 'playwright' = undefined;
  let routing: boolean;

  if (parsedArgs.preset && parsedArgs.preset !== Preset.Angular) {
    preset = parsedArgs.preset;

    if (preset === Preset.AngularStandalone) {
      appName = parsedArgs.name;
    } else {
      appName = await determineAppName(parsedArgs);
    }
  } else {
    const workspaceType = await determineStandaloneOrMonorepo();

    if (workspaceType === 'standalone') {
      preset = Preset.AngularStandalone;
      appName = parsedArgs.name;
    } else {
      preset = Preset.AngularMonorepo;
      appName = await determineAppName(parsedArgs);
    }
  }

  if (parsedArgs.style) {
    style = parsedArgs.style;
  } else {
    const reply = await enquirer.prompt<{ style: string }>([
      {
        name: 'style',
        message: `Default stylesheet format`,
        initial: 'css' as any,
        type: 'autocomplete',
        choices: [
          {
            name: 'css',
            message: 'CSS',
          },
          {
            name: 'scss',
            message: 'SASS(.scss)       [ http://sass-lang.com   ]',
          },
          {
            name: 'less',
            message: 'LESS              [ http://lesscss.org     ]',
          },
        ],
      },
    ]);
    style = reply.style;
  }

  e2eTestRunner = await determineE2eTestRunner(parsedArgs);

  if (parsedArgs.standaloneApi !== undefined) {
    standaloneApi = parsedArgs.standaloneApi;
  } else {
    const reply = await enquirer.prompt<{ standaloneApi: 'Yes' | 'No' }>([
      {
        name: 'standaloneApi',
        message:
          'Would you like to use Standalone Components in your application?',
        type: 'autocomplete',
        choices: [
          {
            name: 'No',
          },
          {
            name: 'Yes',
          },
        ],
        initial: 'No' as any,
      },
    ]);
    standaloneApi = reply.standaloneApi === 'Yes';
  }

  if (parsedArgs.routing !== undefined) {
    routing = parsedArgs.routing;
  } else {
    const reply = await enquirer.prompt<{ routing: 'Yes' | 'No' }>([
      {
        name: 'routing',
        message: 'Would you like to add routing?',
        type: 'autocomplete',
        choices: [
          {
            name: 'Yes',
          },

          {
            name: 'No',
          },
        ],
        initial: 'Yes' as any,
      },
    ]);
    routing = reply.routing === 'Yes';
  }

  return { preset, style, appName, standaloneApi, routing, e2eTestRunner };
}

async function determineNodeOptions(
  parsedArgs: yargs.Arguments<NodeArguments>
): Promise<Partial<Arguments>> {
  let preset: Preset;
  let appName: string;
  let framework: 'express' | 'fastify' | 'koa' | 'nest' | 'none';
  let docker: boolean;

  if (parsedArgs.preset) {
    preset = parsedArgs.preset;

    if (
      preset === Preset.Nest ||
      preset === Preset.Express ||
      preset === Preset.NodeMonorepo
    ) {
      appName = await determineAppName(parsedArgs);
    } else {
      appName = parsedArgs.name;
    }

    if (preset === Preset.NodeStandalone || preset === Preset.NodeMonorepo) {
      framework = await determineNodeFramework(parsedArgs);
    } else {
      framework = 'none';
    }
  } else {
    framework = await determineNodeFramework(parsedArgs);

    const workspaceType = await determineStandaloneOrMonorepo();
    if (workspaceType === 'standalone') {
      preset = Preset.NodeStandalone;
      appName = parsedArgs.name;
    } else {
      preset = Preset.NodeMonorepo;
      appName = await determineAppName(parsedArgs);
    }
  }

  if (parsedArgs.docker !== undefined) {
    docker = parsedArgs.docker;
  } else {
    const reply = await enquirer.prompt<{ docker: 'Yes' | 'No' }>([
      {
        name: 'docker',
        message:
          'Would you like to generate a Dockerfile? [https://docs.docker.com/]',
        type: 'autocomplete',
        choices: [
          {
            name: 'Yes',
            hint: 'I want to generate a Dockerfile',
          },
          {
            name: 'No',
          },
        ],
        initial: 'No' as any,
      },
    ]);
    docker = reply.docker === 'Yes';
  }

  return {
    preset,
    appName,
    framework,
    docker,
  };
}

async function determinePackageBasedOrIntegratedOrStandalone(): Promise<
  'package-based' | 'integrated' | 'standalone'
> {
  const { workspaceType } = await enquirer.prompt<{
    workspaceType: 'standalone' | 'integrated' | 'package-based';
  }>([
    {
      type: 'autocomplete',
      name: 'workspaceType',
      message: `Package-based monorepo, integrated monorepo, or standalone project?`,
      initial: 'package-based' as any,
      choices: [
        {
          name: 'package-based',
          message:
            'Package-based Monorepo:     Nx makes it fast, but lets you run things your way.',
        },
        {
          name: 'integrated',
          message:
            'Integrated Monorepo:        Nx creates a monorepo that contains multiple projects.',
        },
        {
          name: 'standalone',
          message:
            'Standalone:                 Nx creates a single project and makes it fast.',
        },
      ],
    },
  ]);

  invariant(workspaceType, {
    title: 'Invalid workspace type',
    bodyLines: [
      `It must be one of the following: standalone, integrated. Got ${workspaceType}`,
    ],
  });

  return workspaceType;
}

async function determineStandaloneOrMonorepo(): Promise<
  'integrated' | 'standalone'
> {
  const { workspaceType } = await enquirer.prompt<{
    workspaceType: 'standalone' | 'integrated';
  }>([
    {
      type: 'autocomplete',
      name: 'workspaceType',
      message: `Integrated monorepo, or standalone project?`,
      initial: 'standalone' as any,
      choices: [
        {
          name: 'integrated',
          message:
            'Integrated Monorepo:  Nx creates a monorepo that contains multiple projects.',
        },
        {
          name: 'standalone',
          message:
            'Standalone:           Nx creates a single project and makes it fast.',
        },
      ],
    },
  ]);

  invariant(workspaceType, {
    title: 'Invalid workspace type',
    bodyLines: [
      `It must be one of the following: standalone, integrated. Got ${workspaceType}`,
    ],
  });

  return workspaceType;
}

async function determineAppName(
  parsedArgs: yargs.Arguments<
    ReactArguments | AngularArguments | NodeArguments | VueArguments
  >
): Promise<string> {
  if (parsedArgs.appName) return parsedArgs.appName;

  const { appName } = await enquirer.prompt<{ appName: string }>([
    {
      name: 'appName',
      message: `Application name`,
      type: 'input',
      initial: parsedArgs.name,
    },
  ]);
  invariant(appName, {
    title: 'Invalid name',
    bodyLines: [`Name cannot be empty`],
  });
  return appName;
}

async function determineReactFramework(
  parsedArgs: yargs.Arguments<ReactArguments>
): Promise<'none' | 'nextjs' | 'expo' | 'react-native'> {
  const reply = await enquirer.prompt<{
    framework: 'none' | 'nextjs' | 'expo' | 'react-native';
  }>([
    {
      name: 'framework',
      message: 'What framework would you like to use?',
      type: 'autocomplete',
      choices: [
        {
          name: 'none',
          message: 'None',
          hint: '         I only want react and react-dom',
        },
        {
          name: 'nextjs',
          message: 'Next.js       [ https://nextjs.org/      ]',
        },
        {
          name: 'expo',
          message: 'Expo          [ https://expo.io/         ]',
        },
        {
          name: 'react-native',
          message: 'React Native  [ https://reactnative.dev/ ]',
        },
      ],
      initial: 'none' as any,
    },
  ]);
  return reply.framework;
}

async function determineReactBundler(
  parsedArgs: yargs.Arguments<ReactArguments>
): Promise<'webpack' | 'vite' | 'rspack'> {
  if (parsedArgs.bundler) return parsedArgs.bundler;
  const reply = await enquirer.prompt<{
    bundler: 'webpack' | 'vite' | 'rspack';
  }>([
    {
      name: 'bundler',
      message: `Which bundler would you like to use?`,
      type: 'autocomplete',
      choices: [
        {
          name: 'vite',
          message: 'Vite    [ https://vitejs.dev/     ]',
        },
        {
          name: 'webpack',
          message: 'Webpack [ https://webpack.js.org/ ]',
        },
        {
          name: 'rspack',
          message: 'Rspack  [ https://www.rspack.dev/ ]',
        },
      ],
    },
  ]);
  return reply.bundler;
}

async function determineNextAppDir(
  parsedArgs: yargs.Arguments<ReactArguments>
): Promise<boolean> {
  if (parsedArgs.nextAppDir !== undefined) return parsedArgs.nextAppDir;
  const reply = await enquirer.prompt<{ nextAppDir: 'Yes' | 'No' }>([
    {
      name: 'nextAppDir',
      message: 'Would you like to use the App Router (recommended)?',
      type: 'autocomplete',
      choices: [
        {
          name: 'Yes',
        },
        {
          name: 'No',
        },
      ],
      initial: 'Yes' as any,
    },
  ]);
  return reply.nextAppDir === 'Yes';
}

async function determineNodeFramework(
  parsedArgs: yargs.Arguments<NodeArguments>
): Promise<'express' | 'fastify' | 'koa' | 'nest' | 'none'> {
  if (parsedArgs.framework) return parsedArgs.framework;
  const reply = await enquirer.prompt<{
    framework: 'express' | 'fastify' | 'koa' | 'nest' | 'none';
  }>([
    {
      message: 'What framework should be used?',
      type: 'autocomplete',
      name: 'framework',
      choices: [
        {
          name: 'none',
          message: 'None',
        },
        {
          name: 'express',
          message: 'Express [ https://expressjs.com/ ]',
        },
        {
          name: 'fastify',
          message: 'Fastify [ https://www.fastify.dev/ ]',
        },
        {
          name: 'koa',
          message: 'Koa     [ https://koajs.com/      ]',
        },
        {
          name: 'nest',
          message: 'NestJs  [ https://nestjs.com/     ]',
        },
      ],
    },
  ]);
  return reply.framework;
}

async function determineE2eTestRunner(
  parsedArgs: yargs.Arguments<{
    e2eTestRunner?: 'none' | 'cypress' | 'playwright';
  }>
): Promise<'none' | 'cypress' | 'playwright'> {
  if (parsedArgs.e2eTestRunner) return parsedArgs.e2eTestRunner;
  const reply = await enquirer.prompt<{
    e2eTestRunner: 'none' | 'cypress' | 'playwright';
  }>([
    {
      message: 'Test runner to use for end to end (E2E) tests',
      type: 'autocomplete',
      name: 'e2eTestRunner',
      choices: [
        {
          name: 'cypress',
          message: 'Cypress [ https://www.cypress.io/ ]',
        },
        {
          name: 'playwright',
          message: 'Playwright [ https://playwright.dev/ ]',
        },
        {
          name: 'none',
          message: 'None',
        },
      ],
    },
  ]);
  return reply.e2eTestRunner;
}
