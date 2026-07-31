package dev.lucenelens.cli.core.model;

public final class PluginException extends RuntimeException {
    private final String code;
    private final boolean retryable;

    public PluginException(String code, String message) {
        this(code, message, false, null);
    }

    public PluginException(String code, String message, Throwable cause) {
        this(code, message, false, cause);
    }

    public PluginException(String code, String message, boolean retryable, Throwable cause) {
        super(message, cause);
        this.code = code;
        this.retryable = retryable;
    }

    public String code() {
        return code;
    }

    public boolean retryable() {
        return retryable;
    }
}
