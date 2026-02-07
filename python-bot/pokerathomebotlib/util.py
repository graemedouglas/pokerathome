def assert_type(value, typ, *, null_ok: bool = False):
    if null_ok and value is None:
        return
    assert isinstance(value, typ), f"Not a {type(typ).__name__}: {value!r}"


def assert_int_nonneg(value, *, null_ok: bool = False):
    if null_ok and value is None:
        return
    assert isinstance(value, int) and value >= 0, f"Not a nonnegative int: {value!r}"


def assert_int_pos(value, *, null_ok: bool = False):
    if null_ok and value is None:
        return
    assert isinstance(value, int) and value > 0, f"Not a positive int: {value!r}"


def assert_str_nonempty(value, *, null_ok: bool = False):
    if null_ok and value is None:
        return
    assert isinstance(value, str) and value, f"Not a nonempty string: {value!r}"
