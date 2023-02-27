// import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import * as child_process from "child_process";
import { Notice } from "obsidian";
import { LanguageId } from "../main.js";
import { Outputter } from "../Outputter.js";
import { ExecutorSettings } from "../settings/Settings.js";
import AsyncExecutor from "./AsyncExecutor.js";
import killWithChildren from "./killWithChildren.js";

export default abstract class ReplExecutor extends AsyncExecutor {
    process: any;//ChildProcessWithoutNullStreams;
    settings: ExecutorSettings;
    
    abstract wrapCode(code: string, finishSigil: string): string;
    abstract setup(): Promise<void>;
    abstract removePrompts(output: string, source: "stdout" | "stderr"): string;
    
    constructor(settings: ExecutorSettings, path: string, args: string[], file: string, language: LanguageId) {
        super(file, language);
        
        this.settings = settings;
        
        if (this.settings.wslMode) {
            args.unshift("-e", path);
            path = "wsl";
        }

		console.error("ReplExecutor.constructor: path: " + path + ", args: [" + args + "]");
        this.process = child_process.spawn(path, args);//, {env: process.env, shell: true});
        // this.process = child_process.spawn(path, args, {env: process.env, shell: true});

        this.process.on("close", () => {
            this.emit("close");
            new Notice("Runtime exited");
            this.process = null;
        });
        
        this.process.on("error", (err: any) => {
            this.notifyError(settings.pythonPath, args.join(" "), "", err, undefined, "Error launching process: " + err);
            this.stop();
        });
        
        this.setup();
    }
    
    /**
     * Run some code
     * @param code code to run
     * @param outputter outputter to use
     * @param cmd Not used
     * @param cmdArgs Not used
     * @param ext Not used
     * @returns A promise that resolves once the code is done running
     */
    run(code: string, outputter: Outputter, cmd: string, cmdArgs: string, ext: string): Promise<void> {
        outputter.queueBlock();
        
        // TODO: Is handling for reject necessary?
        return this.addJobToQueue((resolve, reject) => {
            if (this.process === null) return resolve();

            const finishSigil = `SIGIL_BLOCK_DONE${Math.random()}_${Date.now()}_${code.length}`;

            outputter.startBlock();

            const wrappedCode = this.wrapCode(code, finishSigil);

            this.process.stdin.write(wrappedCode);

            outputter.clear();

            outputter.on("data", (data: string) => {
                this.process.stdin.write(data);
            });

            const writeToStdout = (data: any) => {
                let str = data.toString();

                if (str.endsWith(finishSigil)) {
                    str = str.substring(0, str.length - finishSigil.length);

                    this.process.stdout.removeListener("data", writeToStdout)
                    this.process.stderr.removeListener("data", writeToStderr);
                    this.process.removeListener("close", resolve);
                    outputter.write(str);

                    resolve();
                } else {
                    outputter.write(str);
                }
            };

            const writeToStderr = (data: any) => {
                outputter.writeErr(
                    this.removePrompts(data.toString(), "stderr")
                );
            }

            this.process.on("close", resolve);

            this.process.stdout.on("data", writeToStdout);
            this.process.stderr.on("data", writeToStderr);
        });
    }
    
    stop(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.process.on("close", () => {
                resolve();
            });            
            
            killWithChildren(this.process.pid);
            this.process = null;
        });
    }
}
