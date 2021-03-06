const { flags: flagsHelper } = require('@oclif/command');
const fs = require('fs');
const path = require('path');
const inquirer = require('inquirer');
const got = require('got');
const unzipper = require('unzipper');
const { ACTOR_TEMPLATES } = require('apify-shared/consts');
const { ApifyCommand } = require('../lib/apify_command');
const execWithLog = require('../lib/exec');
const outputs = require('../lib/outputs');
const { updateLocalJson } = require('../lib/files');
const { setLocalConfig, setLocalEnv, getNpmCmd, validateActorName } = require('../lib/utils');
const { DEFAULT_ACT_TEMPLATE, EMPTY_LOCAL_CONFIG, ACTS_TEMPLATE_LIST } = require('../lib/consts');

class CreateCommand extends ApifyCommand {
    async run() {
        const { flags, args } = this.parse(CreateCommand);
        let { actorName } = args;
        let { template } = flags;

        // Check proper format of actorName
        if (!actorName) {
            const actorNamePrompt = await inquirer.prompt([{
                name: 'actorName',
                message: 'Name of the new actor:',
                type: 'input',
                validate: (promptText) => {
                    try {
                        validateActorName(promptText);
                    } catch (err) {
                        return err.message;
                    }
                    return true;
                },
            }]);
            ({ actorName } = actorNamePrompt);
        } else {
            validateActorName(actorName);
        }

        if (!template) {
            const choices = ACTS_TEMPLATE_LIST.map(templateKey => ACTOR_TEMPLATES[templateKey]);
            const answer = await inquirer.prompt([{
                type: 'list',
                name: 'template',
                message: 'Please select the template for your new actor',
                default: DEFAULT_ACT_TEMPLATE,
                choices,
            }]);
            ({ template } = answer);
        }
        const cwd = process.cwd();
        const actFolderDir = path.join(cwd, actorName);

        // Create actor directory structure
        try {
            fs.mkdirSync(actFolderDir);
        } catch (err) {
            if (err.code && err.code === 'EEXIST') {
                outputs.error(`Cannot create new actor, directory '${actorName}' already exists. `
                    + 'You can use "apify init" to create a local actor environment inside an existing directory.');
                return;
            }
            throw err;
        }
        const templateObj = ACTOR_TEMPLATES[template];
        const { archiveUrl } = templateObj;

        const zipBuffer = got.stream(archiveUrl, { responseType: 'buffer' });
        const unzip = unzipper.Extract({ path: actFolderDir });
        await zipBuffer.pipe(unzip).promise();

        await setLocalConfig(Object.assign(EMPTY_LOCAL_CONFIG, { name: actorName, template }), actFolderDir);
        await setLocalEnv(actFolderDir);
        await updateLocalJson(path.join(actFolderDir, 'package.json'), { name: actorName });

        // Run npm install in actor dir.
        // For efficiency, don't install Puppeteer for templates that don't use it
        const cmdArgs = ['install'];
        if (templateObj.skipOptionalDeps) cmdArgs.push('--no-optional');
        await execWithLog(getNpmCmd(), cmdArgs, { cwd: actFolderDir });

        outputs.success(`Actor '${actorName}' was created. To run it, run "cd ${actorName}" and "apify run".`);
    }
}

CreateCommand.description = 'Creates a new actor project directory from a selected boilerplate template.';

CreateCommand.flags = {
    template: flagsHelper.string({
        char: 't',
        description: 'Boilerplate template for the actor. If not provided, the command will prompt for it.',
        required: false,
        options: ACTS_TEMPLATE_LIST,
    }),
};

CreateCommand.args = [
    {
        name: 'actorName',
        required: false,
        description: 'Name of the actor and its directory',
    },
];

module.exports = CreateCommand;
