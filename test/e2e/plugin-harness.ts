import { fs as appiumFs } from 'appium/support';
import { main as appiumServer } from 'appium';
import getPort from 'get-port';
import { info, success, warning } from 'log-symbols';
import { exec } from 'teen_process';
import { AppiumEnv } from 'appium/types';
import { AppiumServer, ServerArgs } from '@appium/types';
import path from 'path';
import yaml from 'js-yaml';
import fs from 'fs';
import ip from 'ip';
import { sanitizeLog } from '../../src/helpers'; 


type PluginHarnessServerArgs = { subcommand: string; configFile: string };

type E2ESetupOpts = {
  appiumHome?: string;
  before: Mocha.HookFunction | undefined;
  after: Mocha.HookFunction;
  configFile?: string;
  driverSource: import('appium/types').InstallType & string;
  driverPackage?: string;
  driverName: string;
  driverSpec: string;
  pluginSource: import('appium/types').InstallType & string;
  pluginPackage?: string;
  pluginSpec: string;
  pluginName: string;
  port: number;
  host: string;
};

/**
 * Creates hooks to install a driver and a plugin and starts an Appium server w/ the given extensions.
 * @param {E2ESetupOpts} opts
 * @returns {void}
 */
export function pluginE2EHarness(opts: E2ESetupOpts & { enableGoIos?: boolean }) {
  let {
    appiumHome,
    before,
    after,
    configFile,
    driverSource,
    driverPackage,
    driverName,
    driverSpec,
    pluginSource,
    pluginPackage,
    pluginSpec,
    pluginName,
    port,
    host,
    enableGoIos,
  } = opts;

  let server: AppiumServer | undefined = undefined;

  async function goIosPath() {
    const appium_path = path.dirname(require.resolve('appium'));
    console.log(sanitizeLog(`${info} appium_path: ${appium_path}`));// CWE-312: Cleartext Storage of Sensitive Information in Logs
    const node_modules_root = (await exec('npm', ['root', '-g'])).stdout.trim();
    console.log(sanitizeLog(`${info} node_modules_root: ${node_modules_root}`));// CWE-312: Cleartext Storage of Sensitive Information in Logs
    const platform_name = process.platform;
    const arch_name = process.arch;
    const go_ios_dir = path.join(node_modules_root, 'go-ios');
    // find ios binary matching platform name
    let go_ios_bin = fs.readdirSync(go_ios_dir, { recursive: true }).find((item) => {
      console.log(sanitizeLog(`${info} item: ${item}`));// CWE-312: Cleartext Storage of Sensitive Information in Logs
      return item.includes(platform_name);
    });
    console.log(sanitizeLog(`${info} platform: ${platform_name} arch: ${arch_name} go_ios_bin: ${go_ios_bin}`));// CWE-312: Cleartext Storage of Sensitive Information in Logs
    if (!go_ios_bin) {
      // throw new Error(`go-ios binary not found for platform ${platform_name}`);
      go_ios_bin = '';
      console.log(sanitizeLog(`${warning} go-ios binary not found for platform ${platform_name}`));// CWE-312: Cleartext Storage of Sensitive Information in Logs
    }
    const full_path = path.join(go_ios_dir, go_ios_bin.toString(), 'ios');
    return full_path;
  }

  // return appium binary path based on APPIUM_HOME
  function getAppiumBin(): string {
    return require.resolve('appium');
  }

  async function startPlugin() {
    const setupAppiumHome = async () => {
      /**
       * @type {AppiumEnv}
       */
      const env = { ...process.env };

      if (appiumHome) {
        env.APPIUM_HOME = appiumHome;
        //env.HOME = appiumHome;
        await appiumFs.mkdirp(appiumHome);
        console.log(sanitizeLog(`${info} Set \`APPIUM_HOME\` to ${appiumHome}`));//CWE-312: Cleartext Storage of Sensitive Information in Logs
      }

      // find go_ios from npm
      if (enableGoIos) env.GO_IOS = await goIosPath();

      return env;
    };

    /**
     *
     * @param {AppiumEnv} env
     */
    const installDriver = async (env: AppiumEnv) => {
      const APPIUM_BIN = getAppiumBin();
      console.log(sanitizeLog(`${info} Checking if driver "${driverName}" is installed...`));// CWE-312: Cleartext Storage of Sensitive Information in Logs
      const driverListArgs = [APPIUM_BIN, 'driver', 'list', '--json'];
      console.log(sanitizeLog(`${info} Running: ${process.execPath} ${driverListArgs.join(' ')}`));// CWE-312: Cleartext Storage of Sensitive Information in Logs
      const { stdout: driverListJson } = await exec(process.execPath, driverListArgs, {
        env,
      });
      const installedDrivers = JSON.parse(driverListJson);

      if (!installedDrivers[driverName]?.installed) {
        console.log(sanitizeLog(`${warning} Driver "${driverName}" not installed; installing...`));// CWE-312: Cleartext Storage of Sensitive Information in Logs
        const driverArgs = [APPIUM_BIN, 'driver', 'install', '--source', driverSource, driverSpec];
        if (driverPackage) {
          driverArgs.push('--package', driverPackage);
        }
        console.log(sanitizeLog(`${info} Running: ${process.execPath} ${driverArgs.join(' ')}`));
        await exec(process.execPath, driverArgs, {
          env,
        });
      }
      console.log(sanitizeLog(`${success} Installed driver "${driverName}"`));// CWE-312: Cleartext Storage of Sensitive Information in Logs
    };

    async function removePluginFromExtensionsYaml(env: AppiumEnv) {
      const extensionsYaml = path.join(
        env.APPIUM_HOME!,
        'node_modules',
        '.cache',
        'appium',
        'extensions.yaml',
      );
      console.log(sanitizeLog(`${info} Removing plugin "${pluginName}" from ${extensionsYaml}`));//CWE-312: Cleartext Storage of Sensitive Information in Logs
      const extensions = yaml.load(fs.readFileSync(extensionsYaml, 'utf8')) as any;
      delete extensions.plugins[pluginName];
      console.log(sanitizeLog(`${info} Writing back to ${extensionsYaml}`));//CWE-312: Cleartext Storage of Sensitive Information in Logs
      fs.writeFileSync(extensionsYaml, yaml.dump(extensions));
    }

    /**
     *
     * @param {AppiumEnv} env
     */
    const installPlugin = async (env: AppiumEnv) => {
      /*const availablePlugins = await installedPluginsByAppiumCommands(env);
            console.log(`${info} Available plugins: ${JSON.stringify(Object.keys(availablePlugins), null, 2)}`);
            const installedPlugins = Object.keys(availablePlugins).map((item) => availablePlugins[item]).filter((p: any) => p.installed);
            console.log(`${info} Installed plugin: ${JSON.stringify(installedPlugins, null, 2)}`);
            */

      // same plugin maybe installed via different source: npm or local
      // we don't care, just remove it and write it back to the file
      await removePluginFromExtensionsYaml(env);

      // installing our version of plugin
      const pluginArgs = [
        getAppiumBin(),
        'plugin',
        'install',
        '--source',
        pluginSource,
        pluginSpec,
      ];

      // only aplicable for npm
      if (pluginPackage) {
        pluginArgs.push('--package', pluginPackage);
      }
      console.log(sanitizeLog(`${info} Installing plugin: ${process.execPath} ${pluginArgs.join(' ')}`)); // CWE-312: Cleartext Storage of Sensitive Information in Logs
      await exec(process.execPath, pluginArgs, { env });
      console.log(sanitizeLog(`${success} Installed plugin "${pluginName}"`));
    };

    const createServer = async () => {
      if (!port) {
        port = await getPort();
      }
      console.log(sanitizeLog(`${info} Will use port ${port} for Appium server`));// CWE-312: Cleartext Storage of Sensitive Information in Logs      

      // here we are using CLI (instead of AppiumServer) to prevent schema conflicts
      await runAppiumServerFromCli(env, [pluginName], [driverName], configFile);
      // use axios to wait until port is returning 200 OK
      console.log(sanitizeLog(`${info} Waiting for Appium server to be ready...`));// CWE-312: Cleartext Storage of Sensitive Information in Logs
    };

    async function runAppiumServerFromCli(
      env: AppiumEnv,
      usePlugins: string[] = [],
      useDrivers: string[] = [],
      configFile = '',
    ) {
      /**
             example:
             appium server -ka 800 \
                --use-plugins=device-farm,appium-dashboard  \
                --relaxed-security \
                --allow-insecure chromedriver_autodownload,execute_driver_script,adb_shell \
                --config ./hub-config.json \
                -pa /wd/hub
             */
      const APPIUM_BIN = getAppiumBin();
      const serverArgs = [APPIUM_BIN, 'server', '-ka', '800'];
      if (usePlugins.length > 0) {
        serverArgs.push(`--use-plugins=${usePlugins.join(',')}`);
      }
      if (useDrivers.length > 0) {
        serverArgs.push(`--use-drivers=${useDrivers.join(',')}`);
      }
      if (configFile) {
        serverArgs.push(`--config=${configFile}`);
      }
      const logFile = `${configFile.split('.json')[0]}.log`;
      serverArgs.push(`--log=${logFile}`);
      console.log(sanitizeLog(`APPIUM_HOME=${env.APPIUM_HOME} GO_IOS=${env.GO_IOS}`));// CWE-312: Cleartext Storage of Sensitive Information in Logs
      console.log(sanitizeLog(`${info} Running: ${process.execPath} ${serverArgs.join(' ')}`));// CWE-312: Cleartext Storage of Sensitive Information in Logs

      exec(process.execPath, serverArgs, {
        env,
      });
      return waitServer(host ?? ip.address(), port ?? 4723, 60);
    }

    // Use axios to hit appium endpoint until it returns 200 OK
    async function waitServer(host: string, port: number, timeoutSeconds: number) {
      const axios = require('axios');
      // const basePath = serverArgs.basePath || '';
      const url = `http://${host}:${port}/status`;
      const timeout = timeoutSeconds * 1000;
      const start = Date.now();
      while (Date.now() - start < timeout) {
        try {
          await axios.get(url);
          return;
        } catch (ign: any) {
          // ignore
          console.log(sanitizeLog(`${info} url: ${url} error: ${ign.message}`));// CWE-312: Cleartext Storage of Sensitive Information in Logs
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      throw new Error(`Appium server did not start after ${timeoutSeconds} seconds`);
    }

    const env = await setupAppiumHome();
    await installDriver(env);
    await installPlugin(env);
    await createServer();
  }

  async function stopPlugin() {
    if (server) {
      await server.close();
    }
  }

  // clean it after test
  after(stopPlugin);

  // have an option to start the plugin before the test manually
  // this is useful to start multiple plugins in a single test
  if (before) {
    console.log(sanitizeLog("Adding plugin startup into mocha's before hook"));// CWE-312: Cleartext Storage of Sensitive Information in Logs
    before(startPlugin);
  } else {
    console.log(sanitizeLog(`Please start plugin ${pluginName} manually using "startPlugin()" function`));// CWE-312: Cleartext Storage of Sensitive Information in Logs
  }

  return {
    startPlugin,
    stopPlugin,
  };
}
