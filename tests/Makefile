.PHONY: test test-entrypoint test-dockerfile

SHELL := /usr/bin/env bash

test: test-entrypoint test-dockerfile

test-entrypoint:
	@echo "=== test_entrypoint.sh ==="
	@bash test_entrypoint.sh

test-dockerfile:
	@echo "=== test_dockerfile.sh ==="
	@bash test_dockerfile.sh
