import inspect
import math
import re
import types
from copy import deepcopy
from dataclasses import dataclass, replace
from typing import Annotated, Any, Literal, Union, get_args, get_origin, get_type_hints


@dataclass(frozen=True)
class Tool:
    name: str
    description: str
    parameters: dict
    execute: Any

    @property
    def definition(self):
        return {"type": "function", "function": {
            "name": self.name, "description": self.description,
            "parameters": deepcopy(self.parameters),
        }}

    def __call__(self, *args, **kwargs):
        return self.execute(*args, **kwargs)


def _schema(annotation):
    if annotation is Any:
        return {}
    if annotation is None or annotation is type(None):
        return {"type": "null"}
    primitives = {str: "string", int: "integer", float: "number", bool: "boolean"}
    if annotation in (str, int, float, bool):
        return {"type": primitives[annotation]}
    origin, args = get_origin(annotation), get_args(annotation)
    if origin is Annotated:
        return _schema(args[0])
    if origin in (Union, types.UnionType):
        return {"anyOf": [_schema(arg) for arg in args]}
    if origin is Literal:
        return {"enum": list(args)}
    if annotation is list or origin is list:
        return {"type": "array", "items": _schema(args[0]) if args else {}}
    if annotation is dict or origin is dict:
        if args and args[0] is not str:
            raise TypeError("Tool dictionary keys must be strings.")
        return {"type": "object", "additionalProperties": _schema(args[1]) if args else True}
    raise TypeError(f"Unsupported tool annotation: {annotation!r}. Supply an explicit parameters schema.")


def tool(function=None, *, name=None, description=None, parameters=None):
    """Declare a synchronous tool using type hints, or an explicit JSON Schema."""
    def decorate(function):
        if inspect.iscoroutinefunction(function):
            raise TypeError("Python tools must be synchronous functions.")
        schema = parameters
        if schema is None:
            hints = get_type_hints(function, include_extras=True)
            properties, required = {}, []
            for key, parameter in inspect.signature(function).parameters.items():
                if parameter.kind not in (parameter.POSITIONAL_OR_KEYWORD, parameter.KEYWORD_ONLY):
                    raise TypeError("Tool parameters must accept keyword arguments.")
                if key not in hints:
                    raise TypeError(f"Tool parameter {key} needs a type annotation.")
                properties[key] = _schema(hints[key])
                if parameter.default is parameter.empty:
                    required.append(key)
            schema = {"type": "object", "properties": properties,
                      "required": required, "additionalProperties": False}
        return validate_tools([Tool(name or function.__name__,
                                    description if description is not None else inspect.getdoc(function) or "",
                                    schema, function)])[0]
    return decorate if function is None else decorate(function)


def validate_tools(tools):
    if not isinstance(tools, (list, tuple)):
        raise TypeError("Tools must be a list or tuple.")
    names, result = set(), []
    for entry in tools:
        if (not isinstance(entry, Tool) or not isinstance(entry.name, str)
                or not re.fullmatch(r"[a-zA-Z0-9_-]{1,64}", entry.name)
                or not isinstance(entry.description, str) or not isinstance(entry.parameters, dict)
                or entry.parameters.get("type") != "object"
                or not isinstance(entry.parameters.get("properties"), dict) or not callable(entry.execute)):
            raise ValueError("Each tool needs a name, description, object parameter schema, and execute function.")
        if inspect.iscoroutinefunction(entry.execute):
            raise TypeError("Python tools must be synchronous functions.")
        if entry.name in names:
            raise ValueError(f"Duplicate tool name: {entry.name}")
        names.add(entry.name)
        result.append(replace(entry, parameters=deepcopy(entry.parameters)))
    return result


def validate_arguments(value, schema, path):
    if "anyOf" in schema:
        for option in schema["anyOf"]:
            try:
                validate_arguments(value, option, path)
                return
            except ValueError:
                pass
        raise ValueError(f"{path} does not match any allowed type.")
    checks = {
        "string": lambda: isinstance(value, str),
        "integer": lambda: type(value) is int,
        "number": lambda: type(value) is int or (type(value) is float and math.isfinite(value)),
        "boolean": lambda: isinstance(value, bool),
        "null": lambda: value is None,
        "object": lambda: isinstance(value, dict),
        "array": lambda: isinstance(value, list),
    }
    kind = schema.get("type")
    if kind in checks and not checks[kind]():
        raise ValueError(f"{path} must be a {kind}.")
    if "enum" in schema and not any(type(value) is type(entry) and value == entry for entry in schema["enum"]):
        raise ValueError(f"{path} must be one of: {schema['enum']}.")
    if isinstance(value, dict):
        properties = schema.get("properties", {})
        missing = [key for key in schema.get("required", []) if key not in value]
        if missing:
            raise ValueError(f"{path} is missing required field(s): {', '.join(missing)}.")
        unexpected = [key for key in value if key not in properties]
        additional = schema.get("additionalProperties", True)
        if additional is False and unexpected:
            raise ValueError(f"{path} has unknown field(s): {', '.join(unexpected)}. "
                             f"Allowed fields: {', '.join(properties)}.")
        for key, entry in value.items():
            child = properties.get(key, additional if isinstance(additional, dict) else None)
            if child is not None:
                validate_arguments(entry, child, f"{path}.{key}")
    if isinstance(value, list):
        if len(value) < schema.get("minItems", 0):
            raise ValueError(f"{path} needs at least {schema['minItems']} item(s).")
        if "items" in schema:
            for index, entry in enumerate(value):
                validate_arguments(entry, schema["items"], f"{path}[{index}]")
