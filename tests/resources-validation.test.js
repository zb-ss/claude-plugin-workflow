/**
 * Tests for E2E resource files validation
 * Validates JSON structure and content
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PLUGIN_ROOT = path.join(__dirname, '..');

describe('E2E Resource Files Validation', () => {
  describe('webserver-configs.json', () => {
    let config;

    it('should exist and be readable', () => {
      const configPath = path.join(PLUGIN_ROOT, 'resources/e2e/webserver-configs.json');
      assert.ok(fs.existsSync(configPath), 'webserver-configs.json should exist');
      const content = fs.readFileSync(configPath, 'utf-8');
      assert.ok(content.length > 0, 'File should not be empty');
    });

    it('should be valid JSON', () => {
      const configPath = path.join(PLUGIN_ROOT, 'resources/e2e/webserver-configs.json');
      const content = fs.readFileSync(configPath, 'utf-8');
      assert.doesNotThrow(() => {
        config = JSON.parse(content);
      }, 'Should parse as valid JSON');
    });

    it('should have laravel framework configuration', () => {
      const configPath = path.join(PLUGIN_ROOT, 'resources/e2e/webserver-configs.json');
      config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      assert.ok(config.laravel, 'Should have laravel config');
      assert.ok(config.laravel.command, 'Laravel should have command');
      assert.ok(config.laravel.url, 'Laravel should have url');
      assert.strictEqual(typeof config.laravel.reuseExistingServer, 'boolean');
    });

    it('should have symfony framework configuration', () => {
      const configPath = path.join(PLUGIN_ROOT, 'resources/e2e/webserver-configs.json');
      config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      assert.ok(config.symfony, 'Should have symfony config');
      assert.ok(config.symfony.command, 'Symfony should have command');
      assert.ok(config.symfony.url, 'Symfony should have url');
      assert.strictEqual(typeof config.symfony.reuseExistingServer, 'boolean');
    });

    it('should have vue framework configuration', () => {
      const configPath = path.join(PLUGIN_ROOT, 'resources/e2e/webserver-configs.json');
      config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      assert.ok(config.vue, 'Should have vue config');
      assert.ok(config.vue.command, 'Vue should have command');
      assert.ok(config.vue.url, 'Vue should have url');
      assert.strictEqual(typeof config.vue.reuseExistingServer, 'boolean');
    });

    it('should have react framework configuration', () => {
      const configPath = path.join(PLUGIN_ROOT, 'resources/e2e/webserver-configs.json');
      config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      assert.ok(config.react, 'Should have react config');
      assert.ok(config.react.command, 'React should have command');
      assert.ok(config.react.url, 'React should have url');
      assert.strictEqual(typeof config.react.reuseExistingServer, 'boolean');
    });

    it('should have next framework configuration', () => {
      const configPath = path.join(PLUGIN_ROOT, 'resources/e2e/webserver-configs.json');
      config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      assert.ok(config.next, 'Should have next config');
      assert.ok(config.next.command, 'Next should have command');
      assert.ok(config.next.url, 'Next should have url');
      assert.strictEqual(typeof config.next.reuseExistingServer, 'boolean');
    });

    it('should have generic fallback configuration', () => {
      const configPath = path.join(PLUGIN_ROOT, 'resources/e2e/webserver-configs.json');
      config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      assert.ok('generic' in config, 'Should have generic config');
    });

    it('should have URL placeholders in framework configs', () => {
      const configPath = path.join(PLUGIN_ROOT, 'resources/e2e/webserver-configs.json');
      config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

      const frameworksWithPort = ['laravel', 'symfony', 'vue', 'next'];
      frameworksWithPort.forEach(framework => {
        if (config[framework] && config[framework].url) {
          assert.ok(
            config[framework].url.includes('{{PORT}}') || config[framework].url.includes('localhost'),
            `${framework} URL should have localhost reference`
          );
        }
      });
    });

    it('should have command placeholders where applicable', () => {
      const configPath = path.join(PLUGIN_ROOT, 'resources/e2e/webserver-configs.json');
      config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

      // Laravel uses port placeholder
      assert.ok(
        config.laravel.command.includes('{{PORT}}'),
        'Laravel command should have PORT placeholder'
      );

      // Vue uses port placeholder
      assert.ok(
        config.vue.command.includes('{{PORT}}'),
        'Vue command should have PORT placeholder'
      );
    });

    it('should have all framework configs with reuseExistingServer flag', () => {
      const configPath = path.join(PLUGIN_ROOT, 'resources/e2e/webserver-configs.json');
      config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

      const frameworks = ['laravel', 'symfony', 'vue', 'react', 'next'];
      frameworks.forEach(framework => {
        if (config[framework]) {
          assert.ok(
            'reuseExistingServer' in config[framework],
            `${framework} should have reuseExistingServer property`
          );
          assert.strictEqual(
            config[framework].reuseExistingServer,
            true,
            `${framework} reuseExistingServer should be true`
          );
        }
      });
    });
  });

  describe('plugin.json - E2E Agents', () => {
    let pluginConfig;

    it('should exist and be readable', () => {
      const pluginPath = path.join(PLUGIN_ROOT, '.claude-plugin/plugin.json');
      assert.ok(fs.existsSync(pluginPath), 'plugin.json should exist');
      const content = fs.readFileSync(pluginPath, 'utf-8');
      assert.ok(content.length > 0, 'File should not be empty');
    });

    it('should be valid JSON', () => {
      const pluginPath = path.join(PLUGIN_ROOT, '.claude-plugin/plugin.json');
      const content = fs.readFileSync(pluginPath, 'utf-8');
      assert.doesNotThrow(() => {
        pluginConfig = JSON.parse(content);
      }, 'Should parse as valid JSON');
    });

    it('should have agents array', () => {
      const pluginPath = path.join(PLUGIN_ROOT, '.claude-plugin/plugin.json');
      pluginConfig = JSON.parse(fs.readFileSync(pluginPath, 'utf-8'));
      assert.ok(Array.isArray(pluginConfig.agents), 'Should have agents array');
    });

    it('should include e2e-explorer agent', () => {
      const pluginPath = path.join(PLUGIN_ROOT, '.claude-plugin/plugin.json');
      pluginConfig = JSON.parse(fs.readFileSync(pluginPath, 'utf-8'));
      assert.ok(
        pluginConfig.agents.includes('./agents/e2e-explorer.md'),
        'Should include e2e-explorer agent'
      );
    });

    it('should include e2e-generator agent', () => {
      const pluginPath = path.join(PLUGIN_ROOT, '.claude-plugin/plugin.json');
      pluginConfig = JSON.parse(fs.readFileSync(pluginPath, 'utf-8'));
      assert.ok(
        pluginConfig.agents.includes('./agents/e2e-generator.md'),
        'Should include e2e-generator agent'
      );
    });

    it('should include e2e-reviewer agent', () => {
      const pluginPath = path.join(PLUGIN_ROOT, '.claude-plugin/plugin.json');
      pluginConfig = JSON.parse(fs.readFileSync(pluginPath, 'utf-8'));
      assert.ok(
        pluginConfig.agents.includes('./agents/e2e-reviewer.md'),
        'Should include e2e-reviewer agent'
      );
    });

    it('should have all 3 E2E agents registered', () => {
      const pluginPath = path.join(PLUGIN_ROOT, '.claude-plugin/plugin.json');
      pluginConfig = JSON.parse(fs.readFileSync(pluginPath, 'utf-8'));

      const e2eAgents = [
        './agents/e2e-explorer.md',
        './agents/e2e-generator.md',
        './agents/e2e-reviewer.md'
      ];

      const missingAgents = e2eAgents.filter(agent => !pluginConfig.agents.includes(agent));
      assert.strictEqual(
        missingAgents.length,
        0,
        `Missing E2E agents: ${missingAgents.join(', ')}`
      );
    });

    it('should have valid plugin metadata', () => {
      const pluginPath = path.join(PLUGIN_ROOT, '.claude-plugin/plugin.json');
      pluginConfig = JSON.parse(fs.readFileSync(pluginPath, 'utf-8'));

      assert.ok(pluginConfig.name, 'Should have name');
      assert.ok(pluginConfig.description, 'Should have description');
      assert.ok(pluginConfig.version, 'Should have version');
      assert.strictEqual(pluginConfig.version, '4.0.0', 'Version should be 4.0.0');
    });
  });

  describe('E2E Agent Files', () => {
    it('should have e2e-explorer.md file', () => {
      const agentPath = path.join(PLUGIN_ROOT, 'agents/e2e-explorer.md');
      assert.ok(fs.existsSync(agentPath), 'e2e-explorer.md should exist');
      const content = fs.readFileSync(agentPath, 'utf-8');
      assert.ok(content.length > 0, 'File should not be empty');
    });

    it('should have e2e-generator.md file', () => {
      const agentPath = path.join(PLUGIN_ROOT, 'agents/e2e-generator.md');
      assert.ok(fs.existsSync(agentPath), 'e2e-generator.md should exist');
      const content = fs.readFileSync(agentPath, 'utf-8');
      assert.ok(content.length > 0, 'File should not be empty');
    });

    it('should have e2e-reviewer.md file', () => {
      const agentPath = path.join(PLUGIN_ROOT, 'agents/e2e-reviewer.md');
      assert.ok(fs.existsSync(agentPath), 'e2e-reviewer.md should exist');
      const content = fs.readFileSync(agentPath, 'utf-8');
      assert.ok(content.length > 0, 'File should not be empty');
    });
  });

  describe('E2E Template Files', () => {
    it('should have e2e-testing.org template', () => {
      const templatePath = path.join(PLUGIN_ROOT, 'templates/e2e-testing.org');
      assert.ok(fs.existsSync(templatePath), 'e2e-testing.org should exist');
      const content = fs.readFileSync(templatePath, 'utf-8');
      assert.ok(content.length > 0, 'File should not be empty');
    });

    it('should have e2e-testing.md template', () => {
      const templatePath = path.join(PLUGIN_ROOT, 'templates/e2e-testing.md');
      assert.ok(fs.existsSync(templatePath), 'e2e-testing.md should exist');
      const content = fs.readFileSync(templatePath, 'utf-8');
      assert.ok(content.length > 0, 'File should not be empty');
    });

    it('should have placeholders in org template', () => {
      const templatePath = path.join(PLUGIN_ROOT, 'templates/e2e-testing.org');
      const content = fs.readFileSync(templatePath, 'utf-8');

      // Check for common placeholders
      assert.ok(
        content.includes('{{') || content.includes('WORKFLOW_ID') || content.includes('PROJECT_PATH'),
        'Template should have placeholders'
      );
    });

    it('should have placeholders in md template', () => {
      const templatePath = path.join(PLUGIN_ROOT, 'templates/e2e-testing.md');
      const content = fs.readFileSync(templatePath, 'utf-8');

      // Check for common placeholders
      assert.ok(
        content.includes('{{') || content.includes('WORKFLOW_ID') || content.includes('PROJECT_PATH'),
        'Template should have placeholders'
      );
    });
  });

  describe('E2E Resource TypeScript Templates', () => {
    it('should have playwright.config.ts.template', () => {
      const templatePath = path.join(PLUGIN_ROOT, 'resources/e2e/playwright.config.ts.template');
      assert.ok(fs.existsSync(templatePath), 'playwright.config.ts.template should exist');
      const content = fs.readFileSync(templatePath, 'utf-8');
      assert.ok(content.length > 0, 'File should not be empty');
    });

    it('should have global-setup.ts.template', () => {
      const templatePath = path.join(PLUGIN_ROOT, 'resources/e2e/global-setup.ts.template');
      assert.ok(fs.existsSync(templatePath), 'global-setup.ts.template should exist');
      const content = fs.readFileSync(templatePath, 'utf-8');
      assert.ok(content.length > 0, 'File should not be empty');
    });

    it('should have auth-fixture.ts.template', () => {
      const templatePath = path.join(PLUGIN_ROOT, 'resources/e2e/auth-fixture.ts.template');
      assert.ok(fs.existsSync(templatePath), 'auth-fixture.ts.template should exist');
      const content = fs.readFileSync(templatePath, 'utf-8');
      assert.ok(content.length > 0, 'File should not be empty');
    });

    it('should have all 3 TypeScript template files', () => {
      const templates = [
        'playwright.config.ts.template',
        'global-setup.ts.template',
        'auth-fixture.ts.template'
      ];

      templates.forEach(template => {
        const templatePath = path.join(PLUGIN_ROOT, 'resources/e2e', template);
        assert.ok(fs.existsSync(templatePath), `${template} should exist`);
      });
    });

    it('should have .template extension for TypeScript files', () => {
      const templates = [
        'playwright.config.ts.template',
        'global-setup.ts.template',
        'auth-fixture.ts.template'
      ];

      templates.forEach(template => {
        assert.ok(template.endsWith('.template'), `${template} should have .template extension`);
      });
    });
  });
});
