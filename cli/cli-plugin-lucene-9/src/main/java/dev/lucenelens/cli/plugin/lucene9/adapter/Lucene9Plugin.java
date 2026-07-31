package dev.lucenelens.cli.plugin.lucene9.adapter;

import dev.lucenelens.cli.core.spi.LucenePlugin;
import dev.lucenelens.cli.plugin.lucene9.util.Lucene9Util;
import org.apache.lucene.util.Version;

import java.nio.file.Path;
import java.util.Map;

public final class Lucene9Plugin implements LucenePlugin {
    private final Lucene9Util util = new Lucene9Util();

    @Override public String pluginVersion() { return "0.1.0"; }
    @Override public String luceneVersion() { return Version.LATEST.toString(); }
    @Override public Map<String, Object> probe(Path index) { return util.probe(index); }
    @Override public Map<String, Object> summary(Path index) { return util.summary(index); }
    @Override public Map<String, Object> fields(Path index) { return util.fields(index); }
    @Override public Map<String, Object> documents(Path index, String cursor, int limit, boolean includeBinary) {
        return util.documents(index, cursor, limit, includeBinary);
    }
    @Override public Map<String, Object> document(Path index, int docId, boolean includeBinary) {
        return util.document(index, docId, includeBinary);
    }
    @Override public Map<String, Object> query(
            Path index, String query, String analyzer, String cursor, int limit, int maxHits, boolean includeBinary) {
        return util.query(index, query, analyzer, cursor, limit, maxHits, includeBinary);
    }
    @Override public Map<String, Object> exportCsv(
            Path index, Path target, String query, String analyzer, int maxHits) {
        return util.exportCsv(index, target, query, analyzer, maxHits);
    }
}
