import process, { argv, stderr, stdin, stdout } from "node:process";
import { runCli } from "./run";

process.exitCode = await runCli({
  argv,
  env: process.env,
  stdin,
  stdout,
  stderr
});
