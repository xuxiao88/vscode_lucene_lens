package dev.lucenelens.cli.core.model;

public final class AnalyzerDefinition {
    private final String name;
    private final String label;

    public AnalyzerDefinition(String name, String label) {
        this.name = name;
        this.label = label;
    }

    public String getName() {
        return name;
    }

    public String getLabel() {
        return label;
    }
}
