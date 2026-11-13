const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { getAppUpdatePublishConfiguration } = require('app-builder-lib/out/publish/PublishManager')

const script = path.resolve(__dirname, '../build-config/build-pack.js')
const source = fs.readFileSync(script, 'utf8')

async function buildOptions(args) {
  let options
  await vm.runInNewContext(source, {
    require(name) {
      if (name === 'electron-builder') return { build: async value => { options = value } }
      if (name === './build-before-pack' || name === './build-after-pack') return async () => {}
      throw new Error('Unexpected build dependency: ' + name)
    },
    process: { argv: ['node', script, ...args] },
    console: { log() {} },
  }, { filename: script })
  return options
}

test('all packaging targets produce local builds without an official update feed', async () => {
  for (const args of [
    ['target=dir'],
    ['target=mac', 'arch=arm64', 'type=dmg'],
    ['target=mac', 'arch=x64', 'type=dmg'],
    ['target=win', 'arch=x64', 'type=setup'],
    ['target=linux', 'arch=x64', 'type=appImage'],
  ]) {
    const options = await buildOptions(args)
    assert.equal(options.publish, 'never')
    assert.equal(options.config.publish, null)
    // Exercise electron-builder's actual feed resolution, including its repository fallback.
    const config = await getAppUpdatePublishConfiguration({
      config: options.config,
      platformSpecificBuildOptions: {},
      info: { get repositoryInfo() { throw new Error('Must not infer an official feed from package metadata') } },
    }, null, 'arm64', false)
    assert.equal(config, null)
  }
})

test('old release commands cannot publish this local build', async () => {
  for (const policy of ['always', 'onTagOrDraft', 'onTag']) {
    await assert.rejects(buildOptions(['target=dir', 'publish=' + policy]), /does not publish releases/)
  }
  assert.equal((await buildOptions(['target=dir', 'publish=never'])).publish, 'never')
})
