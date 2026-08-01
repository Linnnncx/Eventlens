"""Initial schema placeholder - app uses Base.metadata.create_all on startup."""

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Tables created by SQLAlchemy metadata on app start for SQLite demo simplicity.
    pass


def downgrade() -> None:
    pass
