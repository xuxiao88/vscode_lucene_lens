package dev.lucenelens.cli.core.spi;

import dev.lucenelens.cli.core.model.AnalyzerDefinition;

import java.nio.file.Path;
import java.util.List;
import java.util.Map;

public interface LucenePlugin {
    String pluginVersion();

    String luceneVersion();

    List<AnalyzerDefinition> analyzers();

    Map<String, Object> probe(Path index);

    Map<String, Object> summary(Path index);

    Map<String, Object> fields(Path index);

    Map<String, Object> documents(Path index, String cursor, int limit, boolean includeBinary);

    Map<String, Object> document(Path index, int docId, boolean includeBinary);

    Map<String, Object> query(
            Path index,
            String query,
            String analyzer,
            Map<String, String> fieldAnalyzers,
            String cursor,
            int limit,
            int maxHits,
            boolean includeBinary);

    Map<String, Object> exportCsv(
            Path index,
            Path target,
            String query,
            String analyzer,
            Map<String, String> fieldAnalyzers,
            int maxHits);
}
