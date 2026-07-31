package dev.lucenelens.cli.plugin.lucene9.util;

import dev.lucenelens.cli.core.model.PluginException;
import org.apache.lucene.analysis.Analyzer;
import org.apache.lucene.analysis.cjk.CJKAnalyzer;
import org.apache.lucene.analysis.cn.smart.SmartChineseAnalyzer;
import org.apache.lucene.analysis.core.KeywordAnalyzer;
import org.apache.lucene.analysis.core.SimpleAnalyzer;
import org.apache.lucene.analysis.core.WhitespaceAnalyzer;
import org.apache.lucene.analysis.standard.StandardAnalyzer;
import org.apache.lucene.document.Document;
import org.apache.lucene.index.BinaryDocValues;
import org.apache.lucene.index.CorruptIndexException;
import org.apache.lucene.index.DirectoryReader;
import org.apache.lucene.index.DocValuesType;
import org.apache.lucene.index.FieldInfo;
import org.apache.lucene.index.FieldInfos;
import org.apache.lucene.index.IndexFormatTooNewException;
import org.apache.lucene.index.IndexFormatTooOldException;
import org.apache.lucene.index.IndexNotFoundException;
import org.apache.lucene.index.IndexOptions;
import org.apache.lucene.index.IndexableField;
import org.apache.lucene.index.LeafReader;
import org.apache.lucene.index.LeafReaderContext;
import org.apache.lucene.index.NumericDocValues;
import org.apache.lucene.index.ReaderUtil;
import org.apache.lucene.index.SegmentInfos;
import org.apache.lucene.index.SortedDocValues;
import org.apache.lucene.index.SortedNumericDocValues;
import org.apache.lucene.index.SortedSetDocValues;
import org.apache.lucene.index.StoredFields;
import org.apache.lucene.queryparser.classic.MultiFieldQueryParser;
import org.apache.lucene.queryparser.classic.ParseException;
import org.apache.lucene.queryparser.classic.QueryParser;
import org.apache.lucene.search.IndexSearcher;
import org.apache.lucene.search.Query;
import org.apache.lucene.search.ScoreDoc;
import org.apache.lucene.search.TopDocs;
import org.apache.lucene.search.TotalHits;
import org.apache.lucene.store.Directory;
import org.apache.lucene.store.FSDirectory;
import org.apache.lucene.util.Bits;
import org.apache.lucene.util.BytesRef;

import java.io.BufferedWriter;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.AccessDeniedException;
import java.nio.file.Files;
import java.nio.file.NoSuchFileException;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

public final class Lucene9Util {
    private static final int SUPPORTED_MAJOR = 9;
    private static final int MAX_BINARY_BYTES = 1024 * 1024;

    public Map<String, Object> probe(Path index) {
        validatePath(index);
        try (Directory directory = FSDirectory.open(index.toAbsolutePath().normalize())) {
            if (!DirectoryReader.indexExists(directory)) {
                throw new PluginException("NOT_A_LUCENE_INDEX", "The directory does not contain a Lucene index.");
            }
            SegmentInfos infos = SegmentInfos.readLatestCommit(directory);
            int detectedMajor = infos.getIndexCreatedVersionMajor();
            Map<String, Object> result = map();
            result.put("detectedLuceneMajor", detectedMajor);
            result.put("pluginLuceneMajor", SUPPORTED_MAJOR);
            result.put("compatible", detectedMajor == SUPPORTED_MAJOR);
            result.put("createdVersion", versionText(infos));
            return result;
        } catch (IOException exception) {
            throw mapIOException(exception);
        } catch (RuntimeException exception) {
            throw mapRuntimeException(exception);
        }
    }

    public Map<String, Object> summary(Path index) {
        return withIndex(index, (directory, reader, infos) -> {
            Map<String, Object> result = map();
            result.put("numDocs", reader.numDocs());
            result.put("maxDoc", reader.maxDoc());
            result.put("deletedDocs", reader.numDeletedDocs());
            result.put("segmentCount", reader.leaves().size());
            result.put("createdVersion", versionText(infos));
            result.put("commitGeneration", Long.toString(reader.getIndexCommit().getGeneration()));
            result.put("commitUserData", reader.getIndexCommit().getUserData());
            return result;
        });
    }

    public Map<String, Object> fields(Path index) {
        return withIndex(index, (directory, reader, infos) -> {
            List<Map<String, Object>> items = new ArrayList<>();
            FieldInfos fieldInfos = FieldInfos.getMergedFieldInfos(reader);
            for (FieldInfo field : fieldInfos) {
                Map<String, Object> item = map();
                item.put("name", field.name);
                item.put("indexed", field.getIndexOptions() != IndexOptions.NONE);
                item.put("indexOptions", field.getIndexOptions().name());
                item.put("docValuesType", field.getDocValuesType().name());
                item.put("hasTermVectors", field.hasVectors());
                item.put("pointDimensionCount", field.getPointDimensionCount());
                item.put("variesBySegment", variesBySegment(reader, field.name));
                items.add(item);
            }
            Map<String, Object> result = map();
            result.put("items", items);
            return result;
        });
    }

    public Map<String, Object> documents(Path index, String cursor, int limit, boolean includeBinary) {
        int start = parseDocumentCursor(cursor);
        return withIndex(index, (directory, reader, infos) -> {
            List<Map<String, Object>> items = new ArrayList<>();
            int current = Math.min(start, reader.maxDoc());
            while (current < reader.maxDoc() && items.size() < limit) {
                if (isLive(reader, current)) {
                    items.add(readDocument(reader, current, null, includeBinary));
                }
                current++;
            }
            Map<String, Object> result = map();
            result.put("items", items);
            result.put("total", Integer.toString(reader.numDocs()));
            result.put("totalRelation", "exact");
            result.put("nextCursor", current < reader.maxDoc() ? Integer.toString(current) : null);
            result.put("hasMore", current < reader.maxDoc());
            return result;
        });
    }

    public Map<String, Object> document(Path index, int docId, boolean includeBinary) {
        return withIndex(index, (directory, reader, infos) -> {
            if (docId < 0 || docId >= reader.maxDoc() || !isLive(reader, docId)) {
                throw new PluginException("DOCUMENT_NOT_FOUND", "The document does not exist or is deleted.");
            }
            return readDocument(reader, docId, null, includeBinary);
        });
    }

    public Map<String, Object> query(
            Path index,
            String queryText,
            String analyzerName,
            String cursor,
            int limit,
            int maxHits,
            boolean includeBinary) {
        return withIndex(index, (directory, reader, infos) -> {
            try (Analyzer analyzer = analyzer(analyzerName)) {
                Query parsed = parseQuery(reader, queryText, analyzer);
                QueryCursor queryCursor = decodeQueryCursor(cursor);
                int remaining = Math.max(0, maxHits - queryCursor.seen);
                int requested = Math.min(limit, remaining);
                if (requested == 0) {
                    return emptyQueryPage(maxHits);
                }
                IndexSearcher searcher = new IndexSearcher(reader);
                ScoreDoc after = queryCursor.docId < 0 ? null : new ScoreDoc(queryCursor.docId, queryCursor.score);
                TopDocs topDocs = searcher.searchAfter(after, parsed, requested);
                List<Map<String, Object>> items = new ArrayList<>();
                for (ScoreDoc scoreDoc : topDocs.scoreDocs) {
                    items.add(readDocument(reader, scoreDoc.doc, scoreDoc.score, includeBinary));
                }
                int seen = queryCursor.seen + items.size();
                boolean sourceLowerBound =
                        topDocs.totalHits.relation == TotalHits.Relation.GREATER_THAN_OR_EQUAL_TO;
                boolean capped = topDocs.totalHits.value > maxHits
                        || (sourceLowerBound && seen >= maxHits);
                boolean hasMore = seen < maxHits
                        && (sourceLowerBound ? items.size() == requested : seen < topDocs.totalHits.value);
                String nextCursor = null;
                if (hasMore && topDocs.scoreDocs.length > 0) {
                    ScoreDoc last = topDocs.scoreDocs[topDocs.scoreDocs.length - 1];
                    nextCursor = encodeQueryCursor(last.score, last.doc, seen);
                }
                Map<String, Object> result = map();
                result.put("items", items);
                result.put("total", Long.toString(Math.min(topDocs.totalHits.value, maxHits)));
                result.put("totalRelation", capped || sourceLowerBound
                        ? "lowerBound" : "exact");
                result.put("nextCursor", nextCursor);
                result.put("hasMore", hasMore);
                return result;
            }
        });
    }

    public Map<String, Object> exportCsv(
            Path index,
            Path target,
            String queryText,
            String analyzerName,
            int maxHits) {
        Path normalizedTarget = target.toAbsolutePath().normalize();
        Path parent = normalizedTarget.getParent();
        if (parent == null || !Files.isDirectory(parent)) {
            throw new PluginException("DIRECTORY_NOT_FOUND", "The export target directory does not exist.");
        }
        return withIndex(index, (directory, reader, infos) -> {
            List<CsvColumn> columns = csvColumns(reader);
            long exported;
            try (BufferedWriter writer = Files.newBufferedWriter(
                    normalizedTarget,
                    StandardCharsets.UTF_8,
                    StandardOpenOption.CREATE,
                    StandardOpenOption.TRUNCATE_EXISTING,
                    StandardOpenOption.WRITE)) {
                writer.write('\uFEFF');
                writeCsvHeader(writer, columns, !queryText.isBlank());
                exported = queryText.isBlank()
                        ? exportDocuments(reader, writer, columns)
                        : exportQuery(reader, writer, columns, queryText, analyzerName, maxHits);
            } catch (IOException exception) {
                throw new PluginException("EXPORT_FAILED", "Unable to write the CSV file.", exception);
            }
            Map<String, Object> result = map();
            result.put("target", normalizedTarget.toString());
            result.put("exported", Long.toString(exported));
            result.put("format", "csv");
            return result;
        });
    }

    private long exportDocuments(DirectoryReader reader, BufferedWriter writer, List<CsvColumn> columns)
            throws IOException {
        long count = 0;
        for (int docId = 0; docId < reader.maxDoc(); docId++) {
            if (isLive(reader, docId)) {
                writeCsvRow(writer, readDocument(reader, docId, null, false), columns, false);
                count++;
            }
        }
        return count;
    }

    private long exportQuery(
            DirectoryReader reader,
            BufferedWriter writer,
            List<CsvColumn> columns,
            String queryText,
            String analyzerName,
            int maxHits) throws IOException {
        try (Analyzer analyzer = analyzer(analyzerName)) {
            Query parsed = parseQuery(reader, queryText, analyzer);
            IndexSearcher searcher = new IndexSearcher(reader);
            ScoreDoc after = null;
            long count = 0;
            while (count < maxHits) {
                int batch = (int) Math.min(500, maxHits - count);
                TopDocs topDocs = searcher.searchAfter(after, parsed, batch);
                if (topDocs.scoreDocs.length == 0) break;
                for (ScoreDoc scoreDoc : topDocs.scoreDocs) {
                    writeCsvRow(writer, readDocument(reader, scoreDoc.doc, scoreDoc.score, false), columns, true);
                    count++;
                }
                after = topDocs.scoreDocs[topDocs.scoreDocs.length - 1];
                if (topDocs.scoreDocs.length < batch) break;
            }
            return count;
        }
    }

    private Map<String, Object> readDocument(
            DirectoryReader reader, int docId, Float score, boolean includeBinary) throws IOException {
        Map<String, Object> row = map();
        row.put("docId", docId);
        if (score != null) row.put("score", score);
        row.put("storedFields", readStoredFields(reader, docId, includeBinary));
        row.put("docValues", readDocValues(reader, docId, includeBinary));
        return row;
    }

    private Map<String, Object> readStoredFields(DirectoryReader reader, int docId, boolean includeBinary)
            throws IOException {
        StoredFields storedFields = reader.storedFields();
        Document document = storedFields.document(docId);
        Map<String, Object> result = map();
        for (IndexableField field : document.getFields()) {
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> values =
                    (List<Map<String, Object>>) result.computeIfAbsent(field.name(), ignored -> new ArrayList<>());
            Map<String, Object> value = map();
            Number numeric = field.numericValue();
            BytesRef binary = field.binaryValue();
            if (numeric != null) {
                String type = numeric instanceof Integer ? "int"
                        : numeric instanceof Long ? "long"
                        : numeric instanceof Float ? "float" : "double";
                value.put("type", type);
                value.put("value", numeric.toString());
            } else if (binary != null) {
                value.put("type", "binary");
                value.put("byteLength", binary.length);
                if (includeBinary && binary.length <= MAX_BINARY_BYTES) {
                    value.put("base64", base64(binary));
                }
            } else {
                value.put("type", "string");
                value.put("value", field.stringValue());
            }
            values.add(value);
        }
        return result;
    }

    private Map<String, Object> readDocValues(DirectoryReader reader, int docId, boolean includeBinary)
            throws IOException {
        LeafReaderContext context = reader.leaves().get(ReaderUtil.subIndex(docId, reader.leaves()));
        LeafReader leaf = context.reader();
        int localDocId = docId - context.docBase;
        Map<String, Object> result = map();
        for (FieldInfo field : leaf.getFieldInfos()) {
            DocValuesType type = field.getDocValuesType();
            if (type == DocValuesType.NONE) continue;
            Map<String, Object> docValue = map();
            List<Object> values = new ArrayList<>();
            switch (type) {
                case NUMERIC:
                    NumericDocValues numeric = leaf.getNumericDocValues(field.name);
                    if (numeric != null && numeric.advanceExact(localDocId)) {
                        values.add(Long.toString(numeric.longValue()));
                    }
                    break;
                case BINARY:
                    BinaryDocValues binary = leaf.getBinaryDocValues(field.name);
                    if (binary != null && binary.advanceExact(localDocId)) {
                        values.add(bytesValue(binary.binaryValue(), includeBinary));
                    }
                    break;
                case SORTED:
                    SortedDocValues sorted = leaf.getSortedDocValues(field.name);
                    if (sorted != null && sorted.advanceExact(localDocId)) {
                        values.add(bytesValue(sorted.lookupOrd(sorted.ordValue()), includeBinary));
                    }
                    break;
                case SORTED_NUMERIC:
                    SortedNumericDocValues sortedNumeric = leaf.getSortedNumericDocValues(field.name);
                    if (sortedNumeric != null && sortedNumeric.advanceExact(localDocId)) {
                        for (int i = 0; i < sortedNumeric.docValueCount(); i++) {
                            values.add(Long.toString(sortedNumeric.nextValue()));
                        }
                    }
                    break;
                case SORTED_SET:
                    SortedSetDocValues sortedSet = leaf.getSortedSetDocValues(field.name);
                    if (sortedSet != null && sortedSet.advanceExact(localDocId)) {
                        for (int i = 0; i < sortedSet.docValueCount(); i++) {
                            values.add(bytesValue(sortedSet.lookupOrd(sortedSet.nextOrd()), includeBinary));
                        }
                    }
                    break;
                default:
                    break;
            }
            if (!values.isEmpty()) {
                docValue.put("type", lowerCamel(type.name()));
                docValue.put("values", values);
                result.put(field.name, docValue);
            }
        }
        return result;
    }

    private Query parseQuery(DirectoryReader reader, String queryText, Analyzer analyzer) {
        if (queryText == null || queryText.isBlank()) {
            throw new PluginException("QUERY_PARSE_ERROR", "Query text must not be empty.");
        }
        Set<String> indexedFields = new LinkedHashSet<>();
        for (FieldInfo field : FieldInfos.getMergedFieldInfos(reader)) {
            if (field.getIndexOptions() != IndexOptions.NONE) indexedFields.add(field.name);
        }
        if (indexedFields.isEmpty()) {
            throw new PluginException("QUERY_PARSE_ERROR", "The index has no searchable text fields.");
        }
        try {
            if (indexedFields.size() == 1) {
                return new QueryParser(indexedFields.iterator().next(), analyzer).parse(queryText);
            }
            return new MultiFieldQueryParser(indexedFields.toArray(new String[0]), analyzer).parse(queryText);
        } catch (ParseException exception) {
            throw new PluginException("QUERY_PARSE_ERROR", exception.getMessage(), exception);
        }
    }

    private Analyzer analyzer(String name) {
        switch (name == null ? "standard" : name.toLowerCase(Locale.ROOT)) {
            case "standard": return new StandardAnalyzer();
            case "keyword": return new KeywordAnalyzer();
            case "whitespace": return new WhitespaceAnalyzer();
            case "simple": return new SimpleAnalyzer();
            case "cjk": return new CJKAnalyzer();
            case "smartcn": return new SmartChineseAnalyzer();
            default: throw new PluginException("INVALID_REQUEST", "Unsupported analyzer: " + name);
        }
    }

    private List<CsvColumn> csvColumns(DirectoryReader reader) {
        List<CsvColumn> result = new ArrayList<>();
        Set<String> storedNames = new LinkedHashSet<>();
        try {
            StoredFields storedFields = reader.storedFields();
            for (int docId = 0; docId < reader.maxDoc(); docId++) {
                if (!isLive(reader, docId)) continue;
                for (IndexableField field : storedFields.document(docId).getFields()) {
                    storedNames.add(field.name());
                }
            }
        } catch (IOException exception) {
            throw new PluginException("EXPORT_FAILED", "Unable to inspect stored fields for CSV export.", exception);
        }
        for (String field : storedNames) {
            result.add(new CsvColumn(field, "stored"));
        }
        for (FieldInfo field : FieldInfos.getMergedFieldInfos(reader)) {
            if (field.getDocValuesType() != DocValuesType.NONE) {
                result.add(new CsvColumn(field.name, "docValues"));
            }
        }
        return result;
    }

    private void writeCsvHeader(BufferedWriter writer, List<CsvColumn> columns, boolean includeScore)
            throws IOException {
        List<String> cells = new ArrayList<>();
        cells.add("doc ID");
        if (includeScore) cells.add("score");
        for (CsvColumn column : columns) {
            cells.add(column.field + " (" + column.source + ")");
        }
        writeCsvCells(writer, cells);
    }

    @SuppressWarnings("unchecked")
    private void writeCsvRow(
            BufferedWriter writer, Map<String, Object> row, List<CsvColumn> columns, boolean includeScore)
            throws IOException {
        List<String> cells = new ArrayList<>();
        cells.add(String.valueOf(row.get("docId")));
        if (includeScore) cells.add(String.valueOf(row.getOrDefault("score", "")));
        Map<String, Object> stored = (Map<String, Object>) row.get("storedFields");
        Map<String, Object> docValues = (Map<String, Object>) row.get("docValues");
        for (CsvColumn column : columns) {
            Object raw = "stored".equals(column.source) ? stored.get(column.field) : docValues.get(column.field);
            cells.add(formatCell(raw));
        }
        writeCsvCells(writer, cells);
    }

    private void writeCsvCells(BufferedWriter writer, List<String> cells) throws IOException {
        for (int i = 0; i < cells.size(); i++) {
            if (i > 0) writer.write(',');
            writer.write(csvEscape(cells.get(i)));
        }
        writer.write("\r\n");
    }

    @SuppressWarnings("unchecked")
    private String formatCell(Object raw) {
        if (raw == null) return "";
        if (raw instanceof List<?>) {
            List<String> values = new ArrayList<>();
            for (Object item : (List<?>) raw) values.add(formatCell(item));
            return String.join("\n", values);
        }
        if (raw instanceof Map<?, ?>) {
            Map<String, Object> value = (Map<String, Object>) raw;
            if (value.containsKey("values")) return formatCell(value.get("values"));
            if (value.containsKey("value")) return String.valueOf(value.get("value"));
            if (value.containsKey("text")) return String.valueOf(value.get("text"));
            if (value.containsKey("byteLength")) return "[binary: " + value.get("byteLength") + " bytes]";
        }
        return String.valueOf(raw);
    }

    private String csvEscape(String value) {
        return "\"" + value.replace("\"", "\"\"") + "\"";
    }

    private Map<String, Object> bytesValue(BytesRef bytes, boolean includeBinary) {
        Map<String, Object> value = map();
        value.put("text", bytes.utf8ToString());
        value.put("byteLength", bytes.length);
        if (includeBinary && bytes.length <= MAX_BINARY_BYTES) value.put("base64", base64(bytes));
        return value;
    }

    private String base64(BytesRef bytes) {
        byte[] copy = new byte[bytes.length];
        System.arraycopy(bytes.bytes, bytes.offset, copy, 0, bytes.length);
        return Base64.getEncoder().encodeToString(copy);
    }

    private int parseDocumentCursor(String cursor) {
        try {
            int value = Integer.parseInt(cursor == null || cursor.isBlank() ? "0" : cursor);
            if (value < 0) throw new NumberFormatException();
            return value;
        } catch (NumberFormatException exception) {
            throw new PluginException("INVALID_REQUEST", "Invalid document cursor.");
        }
    }

    private String encodeQueryCursor(float score, int docId, int seen) {
        String raw = Float.toString(score) + ":" + docId + ":" + seen;
        return Base64.getUrlEncoder().withoutPadding().encodeToString(raw.getBytes(StandardCharsets.UTF_8));
    }

    private QueryCursor decodeQueryCursor(String cursor) {
        if (cursor == null || cursor.isBlank()) return new QueryCursor(0f, -1, 0);
        try {
            String raw = new String(Base64.getUrlDecoder().decode(cursor), StandardCharsets.UTF_8);
            String[] parts = raw.split(":", -1);
            if (parts.length != 3) throw new IllegalArgumentException();
            return new QueryCursor(Float.parseFloat(parts[0]), Integer.parseInt(parts[1]), Integer.parseInt(parts[2]));
        } catch (RuntimeException exception) {
            throw new PluginException("INVALID_REQUEST", "Invalid query cursor.");
        }
    }

    private Map<String, Object> emptyQueryPage(int maxHits) {
        Map<String, Object> result = map();
        result.put("items", Collections.emptyList());
        result.put("total", Integer.toString(maxHits));
        result.put("totalRelation", "lowerBound");
        result.put("nextCursor", null);
        result.put("hasMore", false);
        return result;
    }

    private boolean isLive(DirectoryReader reader, int docId) {
        LeafReaderContext context = reader.leaves().get(ReaderUtil.subIndex(docId, reader.leaves()));
        Bits liveDocs = context.reader().getLiveDocs();
        return liveDocs == null || liveDocs.get(docId - context.docBase);
    }

    private boolean variesBySegment(DirectoryReader reader, String fieldName) {
        String signature = null;
        for (LeafReaderContext context : reader.leaves()) {
            FieldInfo field = context.reader().getFieldInfos().fieldInfo(fieldName);
            if (field == null) continue;
            String current = field.getIndexOptions() + ":" + field.getDocValuesType() + ":"
                    + field.hasVectors() + ":" + field.getPointDimensionCount();
            if (signature != null && !signature.equals(current)) return true;
            signature = current;
        }
        return false;
    }

    private String versionText(SegmentInfos infos) {
        return infos.getCommitLuceneVersion() == null
                ? Integer.toString(infos.getIndexCreatedVersionMajor())
                : infos.getCommitLuceneVersion().toString();
    }

    private void validatePath(Path index) {
        if (index == null || !Files.exists(index)) {
            throw new PluginException("DIRECTORY_NOT_FOUND", "The index directory does not exist.");
        }
        if (!Files.isDirectory(index) || !Files.isReadable(index)) {
            throw new PluginException("DIRECTORY_NOT_READABLE", "The index directory is not readable.");
        }
    }

    private <T> T withIndex(Path index, IndexOperation<T> operation) {
        validatePath(index);
        try (Directory directory = FSDirectory.open(index.toAbsolutePath().normalize())) {
            if (!DirectoryReader.indexExists(directory)) {
                throw new PluginException("NOT_A_LUCENE_INDEX", "The directory does not contain a Lucene index.");
            }
            SegmentInfos infos = SegmentInfos.readLatestCommit(directory);
            if (infos.getIndexCreatedVersionMajor() != SUPPORTED_MAJOR) {
                throw new PluginException(
                        "INDEX_VERSION_UNSUPPORTED",
                        "This plugin only supports indexes created by Lucene 9.");
            }
            try (DirectoryReader reader = DirectoryReader.open(directory)) {
                return operation.apply(directory, reader, infos);
            }
        } catch (PluginException exception) {
            throw exception;
        } catch (IOException exception) {
            throw mapIOException(exception);
        } catch (RuntimeException exception) {
            throw mapRuntimeException(exception);
        }
    }

    private PluginException mapIOException(IOException exception) {
        if (exception instanceof NoSuchFileException) {
            return new PluginException("DIRECTORY_NOT_FOUND", "The index directory does not exist.", exception);
        }
        if (exception instanceof AccessDeniedException) {
            return new PluginException("DIRECTORY_NOT_READABLE", "The index directory is not readable.", exception);
        }
        if (exception instanceof IndexNotFoundException) {
            return new PluginException("NOT_A_LUCENE_INDEX", "The directory does not contain a Lucene index.", exception);
        }
        if (exception instanceof CorruptIndexException) {
            return new PluginException("INDEX_CORRUPT", "The Lucene index is corrupt.", exception);
        }
        if (exception instanceof IndexFormatTooOldException || exception instanceof IndexFormatTooNewException) {
            return new PluginException("INDEX_VERSION_UNSUPPORTED", "The Lucene index version is unsupported.", exception);
        }
        return new PluginException("INTERNAL_ERROR", "Unable to read the Lucene index.", exception);
    }

    private RuntimeException mapRuntimeException(RuntimeException exception) {
        if (exception instanceof PluginException) {
            return exception;
        }
        Throwable cause = exception;
        while (cause != null) {
            String message = cause.getMessage();
            if (message != null && message.contains("Could not load codec")) {
                return new PluginException(
                        "INDEX_VERSION_UNSUPPORTED",
                        "The index uses a Lucene codec that is not available in this plugin.",
                        exception);
            }
            cause = cause.getCause();
        }
        return exception;
    }

    private String lowerCamel(String value) {
        String[] parts = value.toLowerCase(Locale.ROOT).split("_");
        StringBuilder result = new StringBuilder(parts[0]);
        for (int i = 1; i < parts.length; i++) {
            result.append(Character.toUpperCase(parts[i].charAt(0))).append(parts[i].substring(1));
        }
        return result.toString();
    }

    private static Map<String, Object> map() {
        return new LinkedHashMap<>();
    }

    @FunctionalInterface
    private interface IndexOperation<T> {
        T apply(Directory directory, DirectoryReader reader, SegmentInfos infos) throws IOException;
    }

    private static final class QueryCursor {
        final float score;
        final int docId;
        final int seen;

        QueryCursor(float score, int docId, int seen) {
            this.score = score;
            this.docId = docId;
            this.seen = seen;
        }
    }

    private static final class CsvColumn {
        final String field;
        final String source;

        CsvColumn(String field, String source) {
            this.field = field;
            this.source = source;
        }
    }
}
