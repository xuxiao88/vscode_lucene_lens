package dev.lucenelens.cli.core.spi;

import dev.lucenelens.cli.core.model.AnalyzerDefinition;
import dev.lucenelens.cli.core.model.PluginException;

import java.io.IOException;
import java.net.URL;
import java.net.URLClassLoader;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Set;
import java.util.ServiceLoader;

public final class PluginLoader implements AutoCloseable {
    private final URLClassLoader classLoader;
    private final LucenePlugin plugin;

    public PluginLoader(Path pluginPath) {
        if (pluginPath == null) {
            throw new PluginException("LUCENE_PLUGIN_NOT_AVAILABLE", "--plugin is required for this command.");
        }
        if (!Files.isRegularFile(pluginPath)) {
            throw new PluginException("LUCENE_PLUGIN_NOT_AVAILABLE", "Lucene plugin jar does not exist.");
        }
        try {
            URL url = pluginPath.toAbsolutePath().normalize().toUri().toURL();
            classLoader = new URLClassLoader(new URL[]{url}, LucenePlugin.class.getClassLoader());
            Iterator<LucenePlugin> plugins = ServiceLoader.load(LucenePlugin.class, classLoader).iterator();
            if (!plugins.hasNext()) {
                closeQuietly();
                throw new PluginException("LUCENE_PLUGIN_LOAD_FAILED", "No Lucene plugin SPI implementation was found.");
            }
            plugin = plugins.next();
            if (plugins.hasNext()) {
                closeQuietly();
                throw new PluginException("LUCENE_PLUGIN_LOAD_FAILED", "The plugin jar contains multiple SPI implementations.");
            }
            validateAnalyzers(plugin);
        } catch (PluginException exception) {
            throw exception;
        } catch (Exception exception) {
            throw new PluginException("LUCENE_PLUGIN_LOAD_FAILED", "Unable to load the Lucene plugin.", exception);
        }
    }

    public LucenePlugin plugin() {
        return plugin;
    }

    @Override
    public void close() throws IOException {
        classLoader.close();
    }

    private void closeQuietly() {
        try {
            classLoader.close();
        } catch (IOException ignored) {
            // The original plugin error is more useful.
        }
    }

    private void validateAnalyzers(LucenePlugin loadedPlugin) {
        List<AnalyzerDefinition> analyzers;
        try {
            analyzers = loadedPlugin.analyzers();
        } catch (RuntimeException exception) {
            closeQuietly();
            throw new PluginException(
                    "LUCENE_PLUGIN_API_INCOMPATIBLE",
                    "The Lucene plugin could not declare its analyzers.",
                    exception);
        }
        if (analyzers == null || analyzers.isEmpty()) {
            closeQuietly();
            throw new PluginException(
                    "LUCENE_PLUGIN_API_INCOMPATIBLE",
                    "The Lucene plugin does not declare any analyzers.");
        }
        Set<String> names = new HashSet<>();
        boolean invalid = analyzers.size() > 100 || analyzers.stream().anyMatch(analyzer ->
                analyzer == null
                        || analyzer.getName() == null
                        || !analyzer.getName().matches("[a-z][a-z0-9_-]{0,63}")
                        || analyzer.getLabel() == null
                        || analyzer.getLabel().isBlank()
                        || analyzer.getLabel().length() > 100
                        || !names.add(analyzer.getName()));
        if (invalid) {
            closeQuietly();
            throw new PluginException(
                    "LUCENE_PLUGIN_API_INCOMPATIBLE",
                    "The Lucene plugin contains an invalid analyzer declaration.");
        }
    }
}
