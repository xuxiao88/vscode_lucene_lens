package dev.lucenelens.cli.core;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.lucenelens.cli.core.model.PluginException;
import dev.lucenelens.cli.core.spi.LucenePlugin;
import dev.lucenelens.cli.core.spi.PluginLoader;
import picocli.CommandLine.Command;
import picocli.CommandLine.Option;
import picocli.CommandLine.ParentCommand;
import picocli.CommandLine.ScopeType;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Callable;
import java.util.function.Function;

@Command(
        name = "lucene-lens-cli",
        subcommands = {
                CliCommand.VersionCommand.class,
                CliCommand.ProbeCommand.class,
                CliCommand.SummaryCommand.class,
                CliCommand.FieldsCommand.class,
                CliCommand.DocumentsCommand.class,
                CliCommand.DocumentCommand.class,
                CliCommand.QueryCommand.class,
                CliCommand.ExportCommand.class
        })
public final class CliCommand implements Callable<Integer> {
    static final String CLI_VERSION = "0.1.1";
    static final int PROTOCOL_VERSION = 1;
    private final ObjectMapper mapper = new ObjectMapper();

    @Option(names = "--plugin", scope = ScopeType.INHERIT, description = "Lucene plugin jar.")
    Path pluginPath;

    @Option(names = "--output", scope = ScopeType.INHERIT, defaultValue = "json")
    String output;

    @Override
    public Integer call() {
        return writeError("INVALID_REQUEST", "A subcommand is required.", false);
    }

    int withPlugin(Function<LucenePlugin, Map<String, Object>> operation) {
        if (!"json".equalsIgnoreCase(output)) {
            return writeError("INVALID_REQUEST", "Only --output json is supported.", false);
        }
        try (PluginLoader loader = new PluginLoader(pluginPath)) {
            LucenePlugin plugin = loader.plugin();
            return writeSuccess(operation.apply(plugin), plugin);
        } catch (Exception exception) {
            return writeThrowable(exception);
        }
    }

    int writeSuccess(Object result, LucenePlugin plugin) {
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("protocolVersion", PROTOCOL_VERSION);
        response.put("cliVersion", CLI_VERSION);
        if (plugin != null) {
            response.put("pluginVersion", plugin.pluginVersion());
            response.put("luceneVersion", plugin.luceneVersion());
        }
        response.put("result", result);
        return write(response, 0);
    }

    int writeThrowable(Throwable throwable) {
        Throwable cause = throwable;
        while (cause.getCause() != null && !(cause instanceof PluginException)) {
            cause = cause.getCause();
        }
        if (cause instanceof PluginException) {
            PluginException pluginException = (PluginException) cause;
            return writeError(pluginException.code(), pluginException.getMessage(), pluginException.retryable());
        }
        System.err.println(throwable.getClass().getName() + ": " + throwable.getMessage());
        return writeError("INTERNAL_ERROR", "An internal CLI error occurred.", false);
    }

    int writeError(String code, String message, boolean retryable) {
        Map<String, Object> error = new LinkedHashMap<>();
        error.put("code", code);
        error.put("message", message == null ? code : message);
        error.put("retryable", retryable);
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("protocolVersion", PROTOCOL_VERSION);
        response.put("cliVersion", CLI_VERSION);
        response.put("error", error);
        int exitCode = code.startsWith("QUERY_") || code.startsWith("DOCUMENT_")
                || code.equals("LIMIT_EXCEEDED") ? 4
                : code.equals("INVALID_REQUEST") ? 2
                : code.startsWith("INDEX_") || code.startsWith("DIRECTORY_")
                || code.startsWith("NOT_A_") || code.startsWith("LUCENE_") ? 3 : 10;
        return write(response, exitCode);
    }

    private int write(Object value, int exitCode) {
        try {
            System.out.println(mapper.writeValueAsString(value));
            return exitCode;
        } catch (Exception exception) {
            System.err.println("Unable to serialize CLI response: " + exception.getMessage());
            return 10;
        }
    }

    abstract static class PluginCommand implements Callable<Integer> {
        @ParentCommand
        CliCommand parent;
    }

    abstract static class IndexCommand extends PluginCommand {
        @Option(names = "--index", required = true)
        Path index;
    }

    @Command(name = "version")
    static final class VersionCommand extends PluginCommand {
        @Override
        public Integer call() {
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("cliVersion", CLI_VERSION);
            result.put("protocolVersion", PROTOCOL_VERSION);
            result.put("javaVersion", System.getProperty("java.version"));
            if (parent.pluginPath == null) {
                return parent.writeSuccess(result, null);
            }
            return parent.withPlugin(plugin -> {
                result.put("pluginVersion", plugin.pluginVersion());
                result.put("luceneVersion", plugin.luceneVersion());
                result.put("analyzers", plugin.analyzers());
                return result;
            });
        }
    }

    @Command(name = "probe")
    static final class ProbeCommand extends IndexCommand {
        @Override public Integer call() { return parent.withPlugin(plugin -> plugin.probe(index)); }
    }

    @Command(name = "summary")
    static final class SummaryCommand extends IndexCommand {
        @Override public Integer call() { return parent.withPlugin(plugin -> plugin.summary(index)); }
    }

    @Command(name = "fields")
    static final class FieldsCommand extends IndexCommand {
        @Override public Integer call() { return parent.withPlugin(plugin -> plugin.fields(index)); }
    }

    @Command(name = "documents")
    static final class DocumentsCommand extends IndexCommand {
        @Option(names = "--cursor", defaultValue = "0") String cursor;
        @Option(names = "--limit", defaultValue = "50") int limit;
        @Option(names = "--include-binary", arity = "0..1", fallbackValue = "true", defaultValue = "false")
        boolean includeBinary;
        @Override public Integer call() {
            validateLimit(limit);
            return parent.withPlugin(plugin -> plugin.documents(index, cursor, limit, includeBinary));
        }
    }

    @Command(name = "document")
    static final class DocumentCommand extends IndexCommand {
        @Option(names = "--doc-id", required = true) int docId;
        @Option(names = "--include-binary", arity = "0..1", fallbackValue = "true", defaultValue = "true")
        boolean includeBinary;
        @Override public Integer call() {
            return parent.withPlugin(plugin -> plugin.document(index, docId, includeBinary));
        }
    }

    @Command(name = "query")
    static final class QueryCommand extends IndexCommand {
        @Option(names = "--query", required = true) String query;
        @Option(names = "--analyzer", required = true) String analyzer;
        @Option(names = "--field-analyzer", arity = "2") List<String> fieldAnalyzers = new ArrayList<>();
        @Option(names = "--cursor", defaultValue = "") String cursor;
        @Option(names = "--limit", defaultValue = "50") int limit;
        @Option(names = "--max-hits", defaultValue = "10000") int maxHits;
        @Option(names = "--include-binary", arity = "0..1", fallbackValue = "true", defaultValue = "false")
        boolean includeBinary;
        @Override public Integer call() {
            validateLimit(limit);
            if (maxHits < 1) throw new PluginException("INVALID_REQUEST", "--max-hits must be positive.");
            return parent.withPlugin(plugin -> {
                Map<String, String> configuredFields = parseFieldAnalyzers(fieldAnalyzers);
                validateAnalyzers(plugin, analyzer, configuredFields);
                return plugin.query(
                        index,
                        query,
                        analyzer,
                        configuredFields,
                        cursor,
                        limit,
                        maxHits,
                        includeBinary);
            });
        }
    }

    @Command(name = "export")
    static final class ExportCommand extends IndexCommand {
        @Option(names = "--target", required = true) Path target;
        @Option(names = "--query", defaultValue = "") String query;
        @Option(names = "--analyzer", required = true) String analyzer;
        @Option(names = "--field-analyzer", arity = "2") List<String> fieldAnalyzers = new ArrayList<>();
        @Option(names = "--max-hits", defaultValue = "10000") int maxHits;
        @Override public Integer call() {
            if (maxHits < 1) throw new PluginException("INVALID_REQUEST", "--max-hits must be positive.");
            return parent.withPlugin(plugin -> {
                Map<String, String> configuredFields = parseFieldAnalyzers(fieldAnalyzers);
                validateAnalyzers(plugin, analyzer, configuredFields);
                return plugin.exportCsv(
                        index,
                        target,
                        query,
                        analyzer,
                        configuredFields,
                        maxHits);
            });
        }
    }

    private static void validateAnalyzers(
            LucenePlugin plugin,
            String analyzer,
            Map<String, String> fieldAnalyzers) {
        List<String> supported = new ArrayList<>();
        plugin.analyzers().forEach(definition -> supported.add(definition.getName()));
        if (!supported.contains(analyzer)) {
            throw new PluginException(
                    "INVALID_REQUEST",
                    "The selected Lucene plugin does not support analyzer: " + analyzer);
        }
        for (String fieldAnalyzer : fieldAnalyzers.values()) {
            if (!supported.contains(fieldAnalyzer)) {
                throw new PluginException(
                        "INVALID_REQUEST",
                        "The selected Lucene plugin does not support analyzer: " + fieldAnalyzer);
            }
        }
    }

    private static Map<String, String> parseFieldAnalyzers(List<String> values) {
        if (values.size() % 2 != 0) {
            throw new PluginException(
                    "INVALID_REQUEST",
                    "--field-analyzer requires a field name followed by an analyzer name.");
        }
        Map<String, String> result = new LinkedHashMap<>();
        for (int index = 0; index < values.size(); index += 2) {
            String field = values.get(index);
            String analyzer = values.get(index + 1);
            if (field.isBlank() || analyzer.isBlank()) {
                throw new PluginException("INVALID_REQUEST", "Field analyzer values must not be blank.");
            }
            if (result.put(field, analyzer) != null) {
                throw new PluginException(
                        "INVALID_REQUEST",
                        "Duplicate field analyzer configuration: " + field);
            }
        }
        return result;
    }

    private static void validateLimit(int limit) {
        if (limit < 1 || limit > 1000) {
            throw new PluginException("LIMIT_EXCEEDED", "--limit must be between 1 and 1000.");
        }
    }
}
