.PHONY: build clean run

APP_NAME = quick-look
BUILD_DIR = build
SOURCES = Sources/main.swift

build:
	@mkdir -p $(BUILD_DIR)
	swiftc \
		-target $(shell uname -m)-apple-macosx13.0 \
		-o $(BUILD_DIR)/$(APP_NAME) \
		-framework Cocoa \
		-framework WebKit \
		$(SOURCES)
	@echo "Built: $(BUILD_DIR)/$(APP_NAME)"

run: build
	$(BUILD_DIR)/$(APP_NAME)

clean:
	rm -rf $(BUILD_DIR)
