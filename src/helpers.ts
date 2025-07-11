/* eslint-disable no-prototype-builtins */
import os from 'os';
import path from 'path';
import tcpPortUsed from 'tcp-port-used';
import getPort from 'get-port';
import { IDevice } from './interfaces/IDevice';
import _ from 'lodash';
import log from './logger';
import Cloud from './enums/Cloud';
import normalizeUrl from 'normalize-url';
import ora from 'ora';
import asyncWait from 'async-wait-until';
import axios from 'axios';
import { FakeModuleLoader } from './fake-module-loader';
import { IExternalModuleLoader } from './interfaces/IExternalModule';

const APPIUM_VENDOR_PREFIX = 'appium:';
export async function asyncForEach(
  array: string | any[],
  callback: {
    (device: any): Promise<void>;
    (udid: any): Promise<void>;
    (arg0: any, arg1: number, arg2: any): any;
  },
) {
  for (let index = 0; index < array.length; index++) {
    await callback(array[index], index, array);
  }
}

// eslint-disable-next-line @typescript-eslint/no-empty-function
export async function spinWith(
  msg: string,
  fn: () => Promise<boolean>,
  callback = (msg: string) => {},
) {
  const spinner = ora(msg).start();
  await asyncWait(
    async () => {
      try {
        const res = await fn();
        spinner.succeed();
        return res;
      } catch (err) {
        spinner.fail();
        if (callback) callback(msg);
        return false;
      }
    },
    {
      intervalBetweenAttempts: 2000,
      timeout: 60 * 1000,
    },
  );
}

export function isMac() {
  return os.type() === 'Darwin';
}

export function cachePath(folder: string) {
  return path.join(os.homedir(), '.cache', 'appium-device-farm', folder);
}
export function isWindows() {
  return os.type() === 'win32';
}

export function checkIfPathIsAbsolute(configPath: string) {
  return path.isAbsolute(configPath);
}

export async function getFreePort() {
  return await getPort();
}

export function nodeUrl(device: IDevice, basePath = ''): string {
  const host = normalizeUrl(device.host, { removeTrailingSlash: false });
  if (device.hasOwnProperty('cloud')) {
    if (device.cloud.toLowerCase() === Cloud.PCLOUDY) {
      return `${host}/wd/hub`;
    } else if (device.cloud.toLowerCase() === Cloud.HEADSPIN) {
      return `${host}`;
    } else {
      return `https://${process.env.CLOUD_USERNAME}:${process.env.CLOUD_KEY}@${
        new URL(device.host).host
      }/wd/hub`;
    }
  }
  // hardcoded the `/wd/hub` for now. This can be fetch from serverArgs.basePath
  return `${host}${basePath || ''}`;
}

export async function isPortBusy(port: number) {
  try {
    if (!port) {
      return false;
    }
    return await tcpPortUsed.check(port);
  } catch (err) {
    return false;
  }
}

export function hasHubArgument(cliArgs: any) {
  return _.has(cliArgs, 'plugin["device-farm"].hub');
}

export function hasCloudArgument(cliArgs: any) {
  return _.has(cliArgs, 'plugin["device-farm"].cloud');
}
// Standard, non-prefixed capabilities (see https://www.w3.org/TR/webdriver/#dfn-table-of-standard-capabilities)
const STANDARD_CAPS = [
  'browserName',
  'browserVersion',
  'platformName',
  'acceptInsecureCerts',
  'pageLoadStrategy',
  'proxy',
  'setWindowRect',
  'timeouts',
  'unhandledPromptBehavior',
];

function isStandardCap(cap: any) {
  return !!_.find(
    STANDARD_CAPS,
    (standardCap) => standardCap.toLowerCase() === `${cap}`.toLowerCase(),
  );
}

// If the 'appium:' prefix was provided and it's a valid capability, strip out the prefix (see https://www.w3.org/TR/webdriver/#dfn-extension-capabilities)
// (NOTE: Method is destructive and mutates contents of caps)
export function stripAppiumPrefixes(caps: any) {
  // split into prefixed and non-prefixed.
  // non-prefixed should be standard caps at this point
  const [prefixedCaps, nonPrefixedCaps] = _.partition(_.keys(caps), (cap) =>
    String(cap).startsWith(APPIUM_VENDOR_PREFIX),
  );

  // initialize this with the k/v pairs of the non-prefixed caps
  const strippedCaps = /** @type {import('@appium/types').Capabilities<C>} */ _.pick(
    caps,
    nonPrefixedCaps,
  );
  const badPrefixedCaps: string[] = [];

  // Strip out the 'appium:' prefix
  for (const prefixedCap of prefixedCaps) {
    const strippedCapName =
      /** @type {import('type-fest').StringKeyOf<import('@appium/types').Capabilities<C>>} */ prefixedCap.substring(
        APPIUM_VENDOR_PREFIX.length,
      ) as string;

    // If it's standard capability that was prefixed, add it to an array of incorrectly prefixed capabilities
    if (isStandardCap(strippedCapName)) {
      badPrefixedCaps.push(strippedCapName);
      if (_.isNil(strippedCaps[strippedCapName])) {
        strippedCaps[strippedCapName] = caps[prefixedCap];
      } else {
        log.warn(
          `Ignoring capability '${prefixedCap}=${caps[prefixedCap]}' and ` +
            `using capability '${strippedCapName}=${strippedCaps[strippedCapName]}'`,
        );
      }
    } else {
      strippedCaps[strippedCapName] = caps[prefixedCap];
    }
  }

  // If we found standard caps that were incorrectly prefixed, throw an exception (e.g.: don't accept 'appium:platformName', only accept just 'platformName')
  if (badPrefixedCaps.length > 0) {
    log.warn(
      `The capabilities ${JSON.stringify(
        badPrefixedCaps,
      )} are standard capabilities and do not require "appium:" prefix`,
    );
  }
  return strippedCaps;
}

export async function isDeviceFarmRunning(host: string): Promise<boolean> {
  try {
    const timeoutMs = 30000;
    const result = await axios({
      method: 'get',
      url: `${host}/device-farm/api/status`,
      timeout: timeoutMs,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    return result.status == 200;
  } catch (error: any) {
    log.info(`Device Farm is not running at ${host}. Error: ${error}`);
    return false;
  }
}

export async function isAppiumRunningAt(url: string): Promise<boolean> {
  try {
    const timeoutMs = 30000;
    const result = await axios({
      method: 'get',
      url: `${url}/status`,
      timeout: timeoutMs,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    return result.status == 200;
  } catch (error: any) {
    log.info(`Appium is not running at ${url}. Error: ${error}`);
    return false;
  }
}

export function safeParseJson(jsonString: string) {
  try {
    return JSON.parse(jsonString);
  } catch (err) {
    return jsonString;
  }
}

export async function loadExternalModules(): Promise<IExternalModuleLoader> {
  // TODO: Should handle DB failures in different way

  // eslint-disable-next-line
  // @ts-ignore
  return import(/* webpackMode: "eager" */ './modules')
    .then((externalModule) => {
      console.log(externalModule);
      return new (externalModule as any).default();
    })
    .catch((err) => {
      console.error('Error Loading External Module', err);
      return new FakeModuleLoader();
    });
  //return new FakeModuleLoader();
}

export async function registerErrorHandlers() {
  process.on('unhandledRejection', (reason, p) => {
    log.error('******  UnhandledRejection ******');
    log.error('Reason:  ');
    console.log(reason);
    log.error((reason as any)?.stack || 'Stacktrace not available');
    log.error('Promise: ', p);
  });
  process.on('uncaughtException', function (exception) {
    log.error('****** UncaughtException ******');
    log.error('Error: ' + exception);
    log.error(exception.stack || 'Stacktrace not available');
  });
}

export function getSessionIdFromUrl(url: string) {
  const SESSION_ID_PATTERN = /\/session\/([^/]+)/;
  const match = SESSION_ID_PATTERN.exec(url);
  if (match) {
    return match[1];
  }
  return null;
}

export function sanitizeLog(input: any): string {
  const str = typeof input === 'string' ? input : JSON.stringify(input);
  return str.replace(/[\r\n]/g, '');
}