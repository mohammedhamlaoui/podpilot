from app.services.openrouter_service import _clean_and_normalize_metadata


def _split_tags(value: str) -> list[str]:
    return [tag.strip() for tag in value.split(",") if tag.strip()]


def test_listing_normalizer_enforces_marketplace_lengths_and_tags():
    result = _clean_and_normalize_metadata(
        {
            "title": "Cottage Tea Room Sign",
            "description": (
                "A charming vintage tea room graphic with teapot artwork, stacked cups, "
                "and cozy country cafe mood for kitchen decor lovers and tea fans."
            ),
            "primary_tag": "tea room",
            "supporting_tags": [
                "tea room",
                "vintage",
                "cottage",
                "teapot",
                "teacups",
                "country kitchen",
                "retro cafe",
                "floral",
                "cozy decor",
                "farmhouse",
                "tea lover",
                "kitchen sign",
                "cafe art",
                "black and white",
                "country blends",
            ],
        },
        "redbubble",
        metadata={"filename": "cottage-tea-room-2.png"},
    )

    tags = _split_tags(result["supporting_tags"])

    assert 40 <= len(result["title"]) <= 60
    assert len(result["description"]) <= 200
    assert len(tags) == 14
    assert result["main_tag"] == "tea room"
    assert "tea room" not in tags


def test_listing_normalizer_fills_missing_tags_to_fourteen():
    result = _clean_and_normalize_metadata(
        {
            "title": "Retro Coffee Cat",
            "description": "Retro coffee cat graphic for cafe humor fans and playful kitchen style.",
            "primary_tag": "coffee cat",
            "supporting_tags": ["retro coffee", "cat lover"],
        },
        "teepublic",
        metadata={"filename": "retro-coffee-cat-kitchen-cafe-funny-morning.png"},
    )

    tags = _split_tags(result["supporting_tags"])

    assert 40 <= len(result["title"]) <= 60
    assert len(result["description"]) <= 200
    assert len(tags) == 14
    assert "coffee cat" not in tags
    assert len(tags) == len(set(tags))
