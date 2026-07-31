package dev.lucenelens.cli.core;

import picocli.CommandLine;

public final class Main {
    private Main() {
    }

    public static void main(String[] args) {
        CliCommand application = new CliCommand();
        CommandLine commandLine = new CommandLine(application);
        commandLine.setCaseInsensitiveEnumValuesAllowed(true);
        commandLine.setParameterExceptionHandler((exception, arguments) ->
                application.writeError("INVALID_REQUEST", exception.getMessage(), false));
        commandLine.setExecutionExceptionHandler((exception, command, parseResult) ->
                application.writeThrowable(exception));
        int exitCode = commandLine.execute(args);
        System.exit(exitCode);
    }
}
